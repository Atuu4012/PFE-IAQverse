"""
Service de prédiction en temps réel avec accès DIRECT à iaq_database.

Ce service:
1. Charge le modèle ML générique
2. Lit les données DIRECTEMENT depuis iaq_database (pas via API)
3. Prédit les valeurs futures (CO2, PM2.5, TVOC) pour N'IMPORTE QUELLE salle/capteur
4. Détecte si les seuils critiques seront dépassés
5. POST des actions préventives via l'API
"""
import contextlib
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional
import logging
import json
import joblib
import requests
from datetime import datetime, timedelta
import time
import sys

# Support pour LSTM
with contextlib.suppress(ImportError):
     import tensorflow as tf

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# Seuils critiques pour la qualité de l'air
CRITICAL_THRESHOLDS = {
    "co2": {
        "warning": 600,
        "critical": 900,
        "danger": 1200
    },
    "pm25": {
        "warning": 10,
        "critical": 25,
        "danger": 50
    },
    "tvoc": {
        "warning": 200,
        "critical": 600,
        "danger": 1000
    },
    "humidity": {
        "warning": 60,
        "critical": 80,
        "danger": 90
    },
    "temperature": {
        "warning": 25,
        "critical": 30,
        "danger": 35
    }
}

# Actions recommandées
RECOMMENDED_ACTIONS = {
    "co2": {
        "warning": "Augmenter la ventilation",
        "critical": "Ouvrir les fenêtres immédiatement",
        "danger": "Évacuer la pièce et aérer complètement"
    },
    "pm25": {
        "warning": "Activer le purificateur d'air",
        "critical": "Purificateur à puissance maximale + ventilation",
        "danger": "Éviter la pièce, purification intensive requise"
    },
    "tvoc": {
        "warning": "Aérer la pièce pendant 15 minutes",
        "critical": "Ventilation intensive + identifier la source",
        "danger": "Évacuer et ventiler complètement la zone"
    }
}


class RealtimeGenericPredictor:
    """Service de prédiction générique avec accès direct à iaq_database."""
    
    def __init__(self, model_dir: Path, api_base_url: str = "http://localhost:8000"):
        """
        Args:
            model_dir: Répertoire contenant les modèles génériques entraînés
            api_base_url: URL de base de l'API FastAPI
        """
        self.model_dir = model_dir
        self.api_base_url = api_base_url
        self.models = {}
        self.scaler = None
        self.salle_encoder = None
        self.capteur_encoder = None
        self.config = None
        
        self.load_models()
    
    def reload(self):
        """Recharge les modèles depuis le disque (appelé après réentraînement)."""
        logger.info("♻️  Rechargement des modèles ML...")
        self.models.clear()
        self.scaler = None
        self.config = None
        self.model_type = None
        # Libérer la mémoire GPU/RAM du modèle Keras précédent
        try:
            import gc
            import tensorflow as tf
            tf.keras.backend.clear_session()
            gc.collect()
        except Exception:
            pass
        self.load_models()
        logger.info(f"✅ Modèle rechargé : type={getattr(self, 'model_type', 'unknown')}")

    def load_models(self):
        """Charge le modèle générique et les encoders."""
        logger.info("Chargement du modèle...")
        
        # 1. Essayer de charger le modèle LSTM (Production)
        lstm_config_path = self.model_dir / "lstm_config.json"
        lstm_model_path = self.model_dir / "lstm_model.keras"
        
        if lstm_config_path.exists() and lstm_model_path.exists():
            try:
                logger.info("Tentative de chargement du modèle LSTM...")
                with open(lstm_config_path, 'r') as f:
                    self.config = json.load(f)
                
                self.models["lstm"] = tf.keras.models.load_model(lstm_model_path)
                self.scaler = joblib.load(self.model_dir / "lstm_scaler.joblib")
                self.model_type = "lstm"
                logger.info("✅ Modèle LSTM Production chargé avec succès")
                # On retourne direct, car le LSTM est prioritaire
                return
            except Exception as e:
                logger.error(f"Erreur chargement LSTM: {e}. Fallback sur modèle générique.")

        # 2. Fallback: Modèle Standard
        # Charger la configuration
        config_path = self.model_dir / "generic_training_config.json"
        if not config_path.exists() and (not hasattr(self, 'config') or self.config is None):
            raise FileNotFoundError(f"Configuration non trouvée: {config_path}")
        
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = json.load(f)
        
        self.model_type = self.config.get('model_type', 'random_forest')
        
        logger.info(f"Configuration: {self.model_type}")
        logger.info(f"Salles entraînées: {self.config.get('trained_rooms', self.config.get('salles_trained', []))}")
        logger.info(f"Capteurs entraînés: {self.config.get('trained_sensors', self.config.get('capteurs_trained', []))}")
        
        # Charger le scaler
        scaler_path = self.model_dir / "generic_scaler.joblib"
        if scaler_path.exists():
            self.scaler = joblib.load(scaler_path)
            logger.info("✓ Scaler chargé")
        
        # Charger les encoders
        salle_encoder_path = self.model_dir / "salle_encoder.joblib"
        if salle_encoder_path.exists():
            self.salle_encoder = joblib.load(salle_encoder_path)
            logger.info("✓ Salle encoder chargé")
        
        capteur_encoder_path = self.model_dir / "capteur_encoder.joblib"
        if capteur_encoder_path.exists():
            self.capteur_encoder = joblib.load(capteur_encoder_path)
            logger.info("✓ Capteur encoder chargé")
        
        # Charger le modèle multi-output unique
        model_path = self.model_dir / "generic_multi_output.joblib"
        if model_path.exists():
            self.models["multi_output"] = joblib.load(model_path)
            logger.info(f"✓ Modèle multi-output chargé ({self.config.get('model_type', 'unknown')})")
        else:
            raise FileNotFoundError(f"Modèle multi-output non trouvé: {model_path}")
        
        logger.info("✅ Modèle générique prêt")
    
    def fetch_recent_data_direct(self, enseigne: Optional[str] = None, 
                                 salle: Optional[str] = None, 
                                 sensor_id: Optional[str] = None,
                                 limit: int = 100) -> pd.DataFrame:
        """
        Récupère les données DIRECTEMENT depuis iaq_database en mémoire.
        Évite un appel HTTP loopback coûteux (~200-400ms).
        Fallback HTTP si iaq_database n'est pas accessible.
        """
        # --- Lecture directe en mémoire (rapide, 0 réseau) ---
        try:
            import sys
            # Le module principal est enregistré sous le nom de package FastAPI
            main_mod = sys.modules.get("backend.main") or sys.modules.get("app.main")
            db = getattr(main_mod, "iaq_database", None) if main_mod else None

            if db is not None:
                # Filtrer
                rows = list(db)  # snapshot de la liste (thread-safe lecture)
                if enseigne:
                    rows = [r for r in rows if r.get("enseigne") == enseigne]
                if salle:
                    rows = [r for r in rows if r.get("salle") == salle]
                if sensor_id:
                    rows = [r for r in rows if r.get("sensor_id") == sensor_id]

                if rows:
                    # Garder les N derniers pour le lookback LSTM (12h @ 5min = 144 points)
                    rows = rows[-limit:]
                    df = pd.DataFrame(rows)
                    if "timestamp" in df.columns:
                        df["timestamp"] = pd.to_datetime(df["timestamp"])
                        df = df.sort_values("timestamp")
                    numeric_cols = ["co2", "pm25", "tvoc", "temperature", "humidity"]
                    for col in numeric_cols:
                        if col in df.columns:
                            df[col] = pd.to_numeric(df[col], errors="coerce")
                    logger.debug(f"[predict] Données lues depuis iaq_database: {len(df)} points")
                    return df
                else:
                    logger.warning(f"[predict] iaq_database vide pour enseigne={enseigne}, salle={salle}")
                    return pd.DataFrame()
        except Exception as e:
            logger.warning(f"[predict] Lecture mémoire échouée ({e}), fallback HTTP")

        # --- Fallback HTTP (si iaq_database non accessible) ---
        try:
            url = f"{self.api_base_url}/api/iaq/data"
            params = {"hours": 12}
            if enseigne:
                params["enseigne"] = enseigne
            if salle:
                params["salle"] = salle
            if sensor_id:
                params["sensor_id"] = sensor_id

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            if not data:
                return pd.DataFrame()

            df = pd.DataFrame(data)
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            df = df.sort_values("timestamp")
            numeric_cols = ["co2", "pm25", "tvoc", "temperature", "humidity"]
            for col in numeric_cols:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")
            if limit and len(df) > limit:
                df = df.tail(limit)
            logger.info(f"[predict] Données récupérées via HTTP fallback: {len(df)} points")
            return df

        except Exception as e:
            logger.error(f"[predict] Erreur récupération données: {e}")
            return pd.DataFrame()

    
    def fetch_lstm_data(self, enseigne: str, salle: str, sensor_id: str, hours: int = 8) -> pd.DataFrame:
        """
        Récupère les données depuis InfluxDB pré-agrégées à l'intervalle d'entraînement.
        Le modèle LSTM a été entraîné sur des données à résolution 5min.
        Alimenter le modèle en données brutes 5s fausse complètement les prédictions
        car le lookback temporel et les features (hour_sin, rolling) sont incohérents.
        """
        try:
            from ..core.influx_client import get_influx_client
            from ..core.settings import settings

            data_interval = self.config.get('data_interval_minutes', 5)

            if not settings.INFLUXDB_ENABLED:
                logger.warning("[LSTM] InfluxDB désactivé, impossible de récupérer données agrégées")
                return pd.DataFrame()

            influx = get_influx_client(
                url=settings.INFLUXDB_URL,
                token=settings.INFLUXDB_TOKEN,
                org=settings.INFLUXDB_ORG,
                bucket=settings.INFLUXDB_BUCKET,
            )
            if not influx or not influx.available:
                logger.warning("[LSTM] InfluxDB indisponible")
                return pd.DataFrame()

            flux_query = f'''
                from(bucket: "{settings.INFLUXDB_BUCKET}")
                    |> range(start: -{hours}h)
                    |> filter(fn: (r) => r._measurement == "iaq_raw")
                    |> filter(fn: (r) => r.salle == "{salle}" and r.sensor_id == "{sensor_id}")
                    |> aggregateWindow(every: {data_interval}m, fn: mean, createEmpty: false)
                    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
                    |> sort(columns: ["_time"])
            '''

            rows = influx.query_data(flux_query)
            if not rows:
                logger.warning(f"[LSTM] Aucune donnée InfluxDB agrégée pour {sensor_id} sur {hours}h")
                return pd.DataFrame()

            df = pd.DataFrame(rows)
            df['timestamp'] = pd.to_datetime(df['timestamp'], format='mixed', utc=True)
            df['timestamp'] = df['timestamp'].dt.tz_localize(None)
            df = df.sort_values('timestamp').reset_index(drop=True)

            for col in ['co2', 'pm25', 'tvoc', 'temperature', 'humidity']:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')

            # Remplir les tags
            df['enseigne'] = enseigne
            df['salle'] = salle
            df['sensor_id'] = sensor_id

            # Occupants
            if 'people' in df.columns:
                df['occupants'] = pd.to_numeric(df['people'], errors='coerce').fillna(0)
            elif 'occupants' not in df.columns:
                df['occupants'] = 0.0

            logger.info(f"[LSTM] Données agrégées {data_interval}min: {len(df)} points "
                        f"(besoin lookback={self.config.get('lookback', 72)})")
            return df

        except Exception as e:
            logger.error(f"[LSTM] Erreur fetch données agrégées InfluxDB: {e}")
            return pd.DataFrame()

    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Crée les mêmes features que lors de l'entraînement (aligné avec ml_train.py)."""
        df = df.copy()
        
        # Features temporelles
        df['hour'] = df['timestamp'].dt.hour
        df['day_of_week'] = df['timestamp'].dt.dayofweek
        
        # Encodage salle/capteur (gérer les valeurs inconnues)
        df['salle_encoded'] = df['salle'].apply(
            lambda x: self.salle_encoder.transform([x])[0] 
            if x in self.salle_encoder.classes_ else -1
        )
        df['sensor_encoded'] = df['sensor_id'].apply(
            lambda x: self.capteur_encoder.transform([x])[0] 
            if x in self.capteur_encoder.classes_ else -1
        )
        
        # Features lag et moyennes mobiles PAR CAPTEUR (comme ml_train.py)
        for (salle, capteur) in df[['salle', 'sensor_id']].drop_duplicates().values:
            mask = (df['salle'] == salle) & (df['sensor_id'] == capteur)
            sensor_df = df[mask].copy()
            
            for col in ['co2', 'pm25', 'tvoc', 'temperature', 'humidity']:
                if col in sensor_df.columns:
                    # Moyennes mobiles 3 et 6
                    df.loc[mask, f'{col}_ma3'] = sensor_df[col].rolling(window=3, min_periods=1).mean()
                    df.loc[mask, f'{col}_ma6'] = sensor_df[col].rolling(window=6, min_periods=1).mean()
                    # Features lag
                    df.loc[mask, f'{col}_lag1'] = sensor_df[col].shift(1)
                    df.loc[mask, f'{col}_lag2'] = sensor_df[col].shift(2)
        
        # Remplir les NaN
        df = df.bfill().ffill()
        
        return df

    # ------------------------------------------------------------------
    # BRANCHE LSTM — Prédiction avec données agrégées 5min InfluxDB
    # ------------------------------------------------------------------
    def _predict_lstm(self, enseigne: str, salle: str, sensor_id: str) -> Dict:
        """
        Prédiction LSTM avec données InfluxDB agrégées à data_interval minutes.
        Le modèle a été entraîné sur des pas de 5min ; lui donner des ticks
        bruts à 5s fausse complètement le lookback, hour_sin et le smoothing.
        """
        try:
            lookback = self.config.get('lookback', 72)
            horizon = self.config.get('horizon', 6)
            data_interval = self.config.get('data_interval_minutes', 5)
            features = self.config.get('features',
                                       ['co2', 'pm25', 'tvoc', 'temperature', 'humidity'])
            targets = self.config.get('targets',
                                      ['co2', 'pm25', 'tvoc', 'temperature', 'humidity'])

            # 1. Données agrégées depuis InfluxDB
            #    Marge x2 pour compenser les trous (restarts Docker, etc.)
            hours_needed = max(12, (lookback * data_interval) // 60 * 2)
            df = self.fetch_lstm_data(enseigne, salle, sensor_id, hours=hours_needed)

            if df.empty or len(df) < lookback:
                available = len(df) if not df.empty else 0
                return {
                    "error": (f"Pas assez de données agrégées {data_interval}min pour LSTM "
                              f"({available} < {lookback}). "
                              f"Besoin d'~{lookback * data_interval // 60}h d'historique."),
                    "enseigne": enseigne, "salle": salle, "sensor_id": sensor_id,
                }

            # 2. Feature engineering identique à l'entraînement
            df['hour_sin'] = np.sin(2 * np.pi * df['timestamp'].dt.hour / 24)
            df['hour_cos'] = np.cos(2 * np.pi * df['timestamp'].dt.hour / 24)
            df['day_sin']  = np.sin(2 * np.pi * df['timestamp'].dt.dayofweek / 7)
            df['day_cos']  = np.cos(2 * np.pi * df['timestamp'].dt.dayofweek / 7)

            if 'occupants' not in df.columns:
                df['occupants'] = 0.0
            else:
                df['occupants'] = df['occupants'].fillna(0)

            # 3. Smoothing identique (rolling 6 sur pas 5min = 30min)
            for col in ["co2", "pm25", "tvoc", "temperature", "humidity"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
                    df[col] = df[col].rolling(window=6, min_periods=1).mean()

            df = df.ffill().bfill()

            # 4. Extraction + Scaling
            X_df = df.tail(lookback)[features].copy()
            X_values = X_df.values

            if self.scaler:
                X_scaled = self.scaler.transform(X_values)
            else:
                X_scaled = X_values

            X_input = X_scaled.reshape(1, lookback, len(features))

            # 5. Prédiction
            model = self.models.get("lstm")
            preds_scaled = model.predict(X_input, verbose=0)
            preds_seq = preds_scaled[0]

            # 6. Inverse transform via dummy matrix
            dummy = np.zeros((horizon, len(features)))
            for i, tgt in enumerate(targets):
                if tgt in features:
                    dummy[:, features.index(tgt)] = preds_seq[:, i]

            inverse_dummy = self.scaler.inverse_transform(dummy) if self.scaler else dummy

            final_preds = {}
            for i, tgt in enumerate(targets):
                if tgt in features:
                    idx = features.index(tgt)
                    # Prendre le DERNIER pas d'horizon (t+30min) — pas le max !
                    # np.max mélangeait les horizons et ne correspondait pas à target_at
                    final_preds[tgt] = float(inverse_dummy[-1, idx])

            for t in ['temperature', 'humidity']:
                if t not in final_preds:
                    final_preds[t] = float(df[t].iloc[-1]) if t in df.columns else None

            # 7. Valeurs courantes + risques
            current_vals = {
                k: float(df[k].iloc[-1]) if k in df.columns else None
                for k in ['co2', 'pm25', 'tvoc', 'humidity']
            }
            risk_analysis = self.analyze_risks(current_vals, final_preds)

            # 8. Auto-évaluation : target_at = now + horizon × data_interval MINUTES
            try:
                from ..core.model_tracker import log_prediction
                now_utc = datetime.utcnow()
                predicted_at = now_utc.isoformat()
                target_at = (now_utc + timedelta(minutes=horizon * data_interval)).isoformat()
                log_prediction(
                    predicted_at=predicted_at,
                    target_at=target_at,
                    enseigne=enseigne,
                    salle=salle,
                    sensor_id=sensor_id,
                    predicted_values=final_preds,
                    model_type="lstm",
                )
            except Exception as track_err:
                logger.debug(f"Tracking prédiction échoué (non bloquant): {track_err}")

            return {
                "timestamp": datetime.now().isoformat(),
                "enseigne": enseigne, "salle": salle, "capteur_id": sensor_id,
                "model": "LSTM",
                "current_values": current_vals,
                "predicted_values": final_preds,
                "forecast_minutes": horizon * data_interval,
                "risk_analysis": risk_analysis,
            }

        except Exception as e:
            logger.error(f"Erreur prédiction LSTM: {e}")
            return {"error": f"LSTM prediction failed: {str(e)}"}

    def predict(self, enseigne: str = "Maison", salle: Optional[str] = None, 
                sensor_id: Optional[str] = None) -> Dict:
        """
        Effectue une prédiction pour une salle/capteur donné.
        
        Args:
            enseigne: Nom de l'enseigne
            salle: Nom de la salle (optionnel si sensor_id fourni)
            sensor_id: ID du capteur
            
        Returns:
            Dict avec les prédictions et recommandations
        """
        # --- BRANCHE LSTM : utilise directement InfluxDB (données agrégées 5min) ---
        # Doit être AVANT fetch_recent_data_direct car iaq_database n'existe plus
        if hasattr(self, 'model_type') and self.model_type == 'lstm':
            return self._predict_lstm(enseigne, salle or "Bureau", sensor_id or "Bureau1")

        # --- BRANCHE CLASSIQUE (modèle générique) ---
        # Récupérer les données récentes directement de iaq_database
        # Limit augmenté à 300 pour supporter les lookbacks larges du LSTM (ex: 144 steps = 12h)
        df = self.fetch_recent_data_direct(enseigne, salle, sensor_id, limit=300)
        
        if df.empty or len(df) < 3:
            return {
                "error": "Not enough recent data for prediction",
                "enseigne": enseigne,
                "salle": salle,
                "sensor_id": sensor_id
            }
        
        # Prendre le dernier capteur s'il y en a plusieurs
        if sensor_id is None and 'sensor_id' in df.columns:
            sensor_id = df['sensor_id'].iloc[-1]
        if salle is None and 'salle' in df.columns:
            salle = df['salle'].iloc[-1]
        
        # Filtrer pour ce capteur spécifique
        df = df[(df['salle'] == salle) & (df['sensor_id'] == sensor_id)]
        
        if df.empty:
            return {"error": f"No data for capteur {sensor_id} in room {salle}"}

        # --- FIN BRANCHE LSTM ---
        
        # Créer les features
        df_features = self.create_features(df)
        
        # Colonnes à exclure des features
        # Utiliser EXACTEMENT les features du training (ordre important)
        if self.config and 'feature_columns' in self.config:
            feature_cols = self.config['feature_columns']
            # Vérifier que toutes les features existent
            missing = [col for col in feature_cols if col not in df_features.columns]
            if missing:
                logger.warning(f"Features manquantes: {missing}")
                return {"error": f"Missing features: {missing}"}
            
            logger.info(f"Using {len(feature_cols)} features from config")
        else:
            # Fallback si pas de config
            exclude_cols = ['timestamp', 'enseigne', 'salle', 'capteur_id', 'sensor_id', 'global_score', 'global_level']
            feature_cols = [col for col in df_features.columns if col not in exclude_cols]
            logger.warning(f"No config, using {len(feature_cols)} auto-detected features")
        
        # Prendre la moyenne des dernières lignes (lookback window)
        lookback = min(self.config.get('lookback_minutes', 10), len(df_features))
        X_recent_df = df_features.tail(lookback)[feature_cols]
        
        logger.info(f"X_recent_df shape: {X_recent_df.shape}, columns: {list(X_recent_df.columns)}")
        
        # Convertir toutes les colonnes en float pour éviter les erreurs de type
        for col in X_recent_df.columns:
            X_recent_df[col] = pd.to_numeric(X_recent_df[col], errors='coerce')
        
        # Remplir les NaN éventuels
        X_recent_df = X_recent_df.fillna(0)
        
        X_recent = X_recent_df.values
        X_input = np.mean(X_recent, axis=0).reshape(1, -1)
        
        # Normaliser
        if self.scaler:
            X_input = self.scaler.transform(X_input)
        
        # Prédiction avec le modèle multi-output
        model = self.models.get("multi_output")
        if not model:
            return {"error": "Multi-output model not loaded"}

        preds = model.predict(X_input)

        # preds peut être de forme (1, n_targets) ou (n_targets,) selon l'API du modèle
        if preds is None:
            return {"error": "Model returned no prediction"}

        preds_array = np.asarray(preds)
        if preds_array.ndim == 1:
            # forme (n_targets,)
            preds_vector = preds_array
        elif preds_array.ndim == 2 and preds_array.shape[0] == 1:
            preds_vector = preds_array[0]
        else:
            # Cas inattendu
            logger.error(f"Prediction shape unexpected: {preds_array.shape}")
            return {"error": f"Unexpected prediction shape: {preds_array.shape}"}

        # Valider que le nombre de targets correspond à la config
        target_cols = self.config.get('target_columns', []) if self.config else []
        if len(preds_vector) != len(target_cols):
            logger.error(f"Nombre de prédictions ({len(preds_vector)}) != targets attendues ({len(target_cols)})")
            return {"error": "Model output size mismatch with config target_columns"}

        # Associer les prédictions aux noms de cibles (en gérant NaN/Inf)
        predictions = {}
        for idx, target in enumerate(target_cols):
            val = float(preds_vector[idx])
            # Remplacer NaN/Inf par None pour compatibilité JSON
            if np.isnan(val) or np.isinf(val):
                predictions[target] = None
            else:
                predictions[target] = val
        
        # Valeurs actuelles (en gérant NaN/Inf)
        def safe_float(series, idx=-1):
            if series.empty:
                return None
            val = float(series.iloc[idx])
            return None if (np.isnan(val) or np.isinf(val)) else val
        
        current_values = {
            "co2": safe_float(df['co2']) if 'co2' in df.columns else None,
            "pm25": safe_float(df['pm25']) if 'pm25' in df.columns else None,
            "tvoc": safe_float(df['tvoc']) if 'tvoc' in df.columns else None,
            "humidity": safe_float(df['humidity']) if 'humidity' in df.columns else None,
        }
        
        # Analyser les risques
        risk_analysis = self.analyze_risks(current_values, predictions)
        
        result = {
            "timestamp": datetime.now().isoformat(),
            "enseigne": enseigne,
            "salle": salle,
            "capteur_id": sensor_id,
            "current_values": current_values,
            "predicted_values": predictions,
            # `forecast_minutes` est le nombre de pas (5min) prévus ; convertir en minutes
            "forecast_minutes": int(self.config.get('forecast_minutes', 0)) * 5,
            "risk_analysis": risk_analysis
        }
        
        return result
    
    def analyze_risks(self, current: Dict, predicted: Dict) -> Dict:
        """Analyse les risques et génère les actions recommandées."""
        risks = {}
        actions_needed = []
        
        for metric in ['co2', 'pm25', 'tvoc']:
            current_val = current.get(metric)
            predicted_val = predicted.get(metric)
            
            if current_val is None or predicted_val is None:
                continue
            
            thresholds = CRITICAL_THRESHOLDS[metric]
            
            current_level = self._get_risk_level(current_val, thresholds)
            predicted_level = self._get_risk_level(predicted_val, thresholds)
            trend = "increasing" if predicted_val > current_val else "decreasing"
            
            risks[metric] = {
                "current_value": round(current_val, 2),
                "predicted_value": round(predicted_val, 2),
                "current_level": current_level,
                "predicted_level": predicted_level,
                "trend": trend,
                "change_percent": round(((predicted_val - current_val) / current_val * 100), 2) if current_val > 0 else 0
            }
            
            # Logique améliorée pour éviter les incohérences
            # 1. Si actuellement critique/danger ET en augmentation -> URGENT
            if current_level in ["critical", "danger"] and trend == "increasing":
                action = {
                    "metric": metric,
                    "level": current_level,
                    "action": RECOMMENDED_ACTIONS[metric][current_level],
                    "priority": "urgent",
                    "estimated_time_to_critical": "Situation critique actuelle en augmentation"
                }
                actions_needed.append(action)
            # 2. Si actuellement critique/danger mais en diminution -> HIGH (situation s'améliore)
            elif current_level in ["critical", "danger"] and trend == "decreasing":
                # Ne pas générer d'action URGENTE si ça s'améliore
                if predicted_level in ["critical", "danger"]:
                    # Reste critique même en diminuant
                    action = {
                        "metric": metric,
                        "level": current_level,
                        "action": RECOMMENDED_ACTIONS[metric][current_level],
                        "priority": "high",
                        "estimated_time_to_critical": "Situation critique avec amélioration prévue"
                    }
                    actions_needed.append(action)
            # 3. Si prédit critique/danger (mais pas encore) -> HIGH/MEDIUM
            elif predicted_level in ["critical", "danger"] and current_level not in ["critical", "danger"]:
                action = {
                    "metric": metric,
                    "level": predicted_level,
                    "action": RECOMMENDED_ACTIONS[metric][predicted_level],
                    "priority": "high" if predicted_level == "danger" else "medium",
                    "estimated_time_to_critical": f"{self.config['forecast_minutes'] * 5} minutes"
                }
                actions_needed.append(action)
        
        return {
            "metrics": risks,
            "actions_needed": actions_needed,
            "overall_status": self._get_overall_status(risks)
        }
    
    def _get_risk_level(self, value: float, thresholds: Dict) -> str:
        """Détermine le niveau de risque."""
        if value >= thresholds['danger']:
            return "danger"
        elif value >= thresholds['critical']:
            return "critical"
        elif value >= thresholds['warning']:
            return "warning"
        else:
            return "good"
    
    def _get_overall_status(self, risks: Dict) -> str:
        """Détermine le statut global."""
        levels = [risk['predicted_level'] for risk in risks.values()]
        
        if "danger" in levels:
            return "danger"
        elif "critical" in levels:
            return "critical"
        elif "warning" in levels:
            return "warning"
        else:
            return "good"
    
    def post_preventive_actions(self, prediction_result: Dict) -> bool:
        """POST les actions préventives à l'API."""
        actions = prediction_result.get('risk_analysis', {}).get('actions_needed', [])
        
        if not actions:
            logger.info("✅ Aucune action préventive nécessaire")
            return True
        
        try:
            url = f"{self.api_base_url}/api/iaq/actions/preventive"
            
            payload = {
                "timestamp": prediction_result['timestamp'],
                "enseigne": prediction_result['enseigne'],
                "salle": prediction_result['salle'],
                "capteur_id": prediction_result.get('capteur_id'),
                "actions": actions,
                "prediction_details": {
                    "current": prediction_result['current_values'],
                    "predicted": prediction_result['predicted_values'],
                    "forecast_minutes": prediction_result['forecast_minutes']
                }
            }
            
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            
            logger.info(f"✅ Actions préventives envoyées: {len(actions)} actions")
            for action in actions:
                logger.info(f"  - [{action['priority']}] {action['metric']}: {action['action']}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de l'envoi des actions: {e}")
            return False
    
    def monitor_continuous(self, enseigne: str = "Maison", 
                          capteurs: List[str] = None, 
                          interval_seconds: int = 300):
        """
        Surveillance continue avec prédictions périodiques.
        
        Args:
            enseigne: Nom de l'enseigne
            capteurs: Liste des IDs de capteurs à surveiller
            interval_seconds: Intervalle entre les prédictions
        """
        logger.info(f"🔄 Démarrage de la surveillance continue")
        logger.info(f"Enseigne: {enseigne}, Capteurs: {capteurs or 'TOUS'}")
        logger.info(f"Intervalle: {interval_seconds} secondes")
        
        iteration = 0
        while True:
            try:
                iteration += 1
                logger.info(f"\n{'='*60}")
                logger.info(f"Itération #{iteration} - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                logger.info(f"{'='*60}")
                
                # Si aucun capteur spécifié, récupérer tous les capteurs actifs
                if not capteurs:
                    df_all = self.fetch_recent_data_direct(enseigne=enseigne, limit=50)
                    if not df_all.empty:
                        capteurs = df_all['capteur_id'].unique().tolist()
                        logger.info(f"Capteurs détectés: {capteurs}")
                
                for capteur_id in (capteurs or []):
                    logger.info(f"\n📊 Analyse de {capteur_id}...")
                    
                    # Prédiction
                    result = self.predict(enseigne=enseigne, capteur_id=capteur_id)
                    
                    if "error" in result:
                        logger.warning(f"⚠️ {result['error']}")
                        continue
                    
                    # Afficher le résumé
                    logger.info(f"Statut: {result['risk_analysis']['overall_status'].upper()}")
                    
                    # Envoyer les actions si nécessaires
                    if result['risk_analysis']['actions_needed']:
                        self.post_preventive_actions(result)
                    else:
                        logger.info("✅ Qualité de l'air correcte")
                
                # Attendre avant la prochaine itération
                logger.info(f"\n⏳ Prochaine analyse dans {interval_seconds} secondes...")
                time.sleep(interval_seconds)
                
            except KeyboardInterrupt:
                logger.info("\n🛑 Arrêt de la surveillance")
                break
            except Exception as e:
                logger.error(f"❌ Erreur: {e}")
                time.sleep(interval_seconds)


def main():
    """Fonction principale."""
    
    base_dir = Path(__file__).parent.parent
    model_dir = base_dir / "assets" / "ml_models"
    
    if not model_dir.exists() or not (model_dir / "generic_training_config.json").exists():
        logger.error(f"Modèles non trouvés dans: {model_dir}")
        logger.error("Exécutez d'abord: python ml_train_generic.py")
        return
    
    # Créer le prédicteur
    predictor = RealtimeGenericPredictor(model_dir, api_base_url="http://localhost:8000")
    
    # Mode
    print("\n" + "="*60)
    print("Service de Prédiction Générique en Temps Réel")
    print("="*60)
    print("\n1. Prédiction unique")
    print("2. Surveillance continue")
    
    choice = input("\nChoisir le mode (1 ou 2): ").strip()
    
    if choice == "1":
        enseigne = input("Enseigne (défaut: Maison): ").strip() or "Maison"
        capteur_id = input("Capteur ID (ex: Bureau1): ").strip()
        
        if not capteur_id:
            print("❌ Capteur ID requis")
            return
        
        logger.info(f"\n🔮 Prédiction pour {capteur_id}...")
        result = predictor.predict(enseigne=enseigne, capteur_id=capteur_id)
        
        if "error" in result:
            logger.error(f"❌ {result['error']}")
        else:
            print("\n" + "="*60)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            print("="*60)
            
            if result['risk_analysis']['actions_needed']:
                predictor.post_preventive_actions(result)
    
    elif choice == "2":
        enseigne = input("Enseigne (défaut: Maison): ").strip() or "Maison"
        capteurs_input = input("Capteurs séparés par virgules (vide = TOUS): ").strip()
        capteurs = [c.strip() for c in capteurs_input.split(",")] if capteurs_input else None
        
        interval = input("Intervalle en secondes (défaut: 300): ").strip()
        interval_seconds = int(interval) if interval.isdigit() else 300
        
        predictor.monitor_continuous(enseigne, capteurs, interval_seconds)
    
    else:
        print("Choix invalide")


if __name__ == "__main__":
    main()
