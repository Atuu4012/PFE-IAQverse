"""
Script d'entraînement simple pour la prédiction de qualité d'air intérieur.

Entraîne un modèle VotingRegressor (RF + GB) qui prédit les valeurs futures.
Peut combiner données CSV + InfluxDB pour réentraînement périodique.
"""

import pandas as pd
import numpy as np
from pathlib import Path
import logging
import json
import joblib
import requests
import argparse

from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, VotingRegressor
from sklearn.multioutput import MultiOutputRegressor
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import mean_squared_error, r2_score

logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
logger = logging.getLogger(__name__)

# Configuration
FEATURES = ['co2', 'pm25', 'tvoc', 'temperature', 'humidity']
TARGETS = ['co2', 'pm25', 'tvoc', 'humidity']
import os
API_URL = os.getenv("API_URL", "http://localhost:8000/api/iaq/data?hours=72")


def charger_dataset_csv(chemin_csv):
    """Charge et nettoie le dataset CSV"""
    logger.info(f"📂 Chargement CSV: {chemin_csv}")
    df = pd.read_csv(chemin_csv)
    
    # Nettoyer les colonnes
    df.columns = df.columns.str.strip().str.replace('"', '')
    
    # Renommer capteur_id en sensor_id
    if 'capteur_id' in df.columns:
        df = df.rename(columns={'capteur_id': 'sensor_id'})
    
    # Convertir les valeurs numériques
    for col in FEATURES:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    
    df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True)
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    logger.info(f"✅ {len(df)} lignes chargées")
    return df


def recuperer_donnees_influxdb():
    """Récupère les données récentes depuis InfluxDB via l'API"""
    try:
        logger.info("📡 Récupération InfluxDB...")
        response = requests.get(API_URL, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if not data:
            logger.warning("⚠️  Aucune donnée InfluxDB")
            return pd.DataFrame()
        
        df = pd.DataFrame(data)
        df['timestamp'] = pd.to_datetime(df['timestamp'], format='ISO8601', utc=True)
        logger.info(f"✅ {len(df)} lignes InfluxDB récupérées")
        return df
    except Exception as e:
        logger.warning(f"⚠️  Erreur InfluxDB: {e}")
        return pd.DataFrame()


def creer_features(df):
    """Crée les features avancées pour le ML"""
    df = df.copy()
    
    # Convertir colonnes numériques
    for col in FEATURES:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # Features temporelles basiques
    df['hour'] = df['timestamp'].dt.hour
    df['day_of_week'] = df['timestamp'].dt.dayofweek
    df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)
    
    # Features temporelles cycliques (sin/cos pour capturer la périodicité)
    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
    df['day_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
    df['day_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
    
    # Encodage salle et sensor
    salle_encoder = LabelEncoder()
    sensor_encoder = LabelEncoder()
    
    df['salle_encoded'] = salle_encoder.fit_transform(df['salle'].fillna('Unknown'))
    df['sensor_encoded'] = sensor_encoder.fit_transform(df['sensor_id'].fillna('Unknown'))
    
    # Trier par sensor_id et timestamp pour les features temporelles
    df = df.sort_values(['sensor_id', 'timestamp']).reset_index(drop=True)
    
    # Features dérivées avancées pour chaque mesure
    for col in FEATURES:
        if col in df.columns:
            # Différence (dérivée discrète)
            df[f'{col}_diff'] = df.groupby('sensor_id')[col].diff()
            
            # Moyennes mobiles multiples
            df[f'{col}_ma3'] = df.groupby('sensor_id')[col].rolling(window=3, min_periods=1).mean().reset_index(0, drop=True)
            df[f'{col}_ma6'] = df.groupby('sensor_id')[col].rolling(window=6, min_periods=1).mean().reset_index(0, drop=True)
            
            # Écart-type mobile (volatilité)
            df[f'{col}_std3'] = df.groupby('sensor_id')[col].rolling(window=3, min_periods=1).std().reset_index(0, drop=True)
            
            # Lag features (valeurs précédentes)
            df[f'{col}_lag1'] = df.groupby('sensor_id')[col].shift(1)
            df[f'{col}_lag2'] = df.groupby('sensor_id')[col].shift(2)
    
    # Features d'interaction (ratios importants pour QAI)
    df['co2_tvoc_ratio'] = df['co2'] / (df['tvoc'] + 1)
    df['pm25_humidity_ratio'] = df['pm25'] / (df['humidity'] + 1)
    df['temp_humidity_interaction'] = df['temperature'] * df['humidity']
    
    # Remplir NaN (causés par diff, lag, std)
    df = df.ffill().bfill().fillna(0)
    
    return df, salle_encoder, sensor_encoder


def preparer_donnees_entrainement(df):
    """Prépare X et y pour l'entraînement (top 20 features)"""
    # Colonnes à exclure
    exclude_cols = ['timestamp', 'enseigne', 'salle', 'sensor_id', 
                   'global_score', 'global_level']
    
    # TOP 20 FEATURES (basé sur l'importance mesurée, sans doublons)
    top_20_features = [
        # Top valeurs actuelles (5)
        'humidity', 'co2', 'tvoc', 'pm25', 'temperature',
        # Top moyennes mobiles (6)
        'humidity_ma3', 'pm25_ma3', 'co2_ma3', 'tvoc_ma6', 'pm25_ma6', 'humidity_ma6',
        # Top lag features (5)
        'co2_lag1', 'humidity_lag1', 'pm25_lag1', 'tvoc_lag2', 'tvoc_lag1',
        # Encodages (2)
        'sensor_encoded', 'salle_encoded',
        # Temporelles (2)
        'hour', 'day_of_week'
    ]
    
    # Garder seulement les features qui existent dans le DataFrame
    feature_cols = [col for col in top_20_features if col in df.columns]
    
    X = df[feature_cols].values
    y = df[TARGETS].values
    
    logger.info(f"📊 Top 20 Features: {feature_cols}")
    logger.info(f"🎯 Targets: {TARGETS}")
    
    return X, y, feature_cols


def entrainer_modele(X_train, y_train):
    """Entraîne le modèle VotingRegressor (RF + GB + XGB) optimisé"""
    logger.info("🧠 Entraînement VotingRegressor...")
    
    # Random Forest optimisé
    rf = RandomForestRegressor(
        n_estimators=200,  # Plus d'arbres pour meilleure généralisation
        max_depth=15,  # Équilibre entre complexité et généralisation
        min_samples_split=10,
        min_samples_leaf=4,
        max_features='sqrt',
        bootstrap=True,
        oob_score=True,  # Out-of-bag score pour validation
        random_state=42,
        n_jobs=-1
    )
    
    # Gradient Boosting optimisé
    gb = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        min_samples_split=10,
        min_samples_leaf=4,
        max_features='sqrt',
        random_state=42
    )
    
    # Voting avec poids optimisés (GB légèrement favorisé)
    voting = VotingRegressor([
        ('rf', rf),
        ('gb', gb)
    ], weights=[1, 1.2])  # GB a 20% plus de poids
    
    model = MultiOutputRegressor(voting)
    model.fit(X_train, y_train)
    
    # Afficher OOB score du RF
    logger.info(f"   RF OOB Score moyen: {np.mean([est.named_estimators_['rf'].oob_score_ for est in model.estimators_]):.3f}")
    
    logger.info("✅ Modèle entraîné")
    return model


def evaluer_modele(model, X_test, y_test, feature_cols):
    """Évalue le modèle avec métriques avancées"""
    y_pred = model.predict(X_test)
    
    logger.info("\n📈 RÉSULTATS:")
    resultats = {}
    for i, target in enumerate(TARGETS):
        rmse = np.sqrt(mean_squared_error(y_test[:, i], y_pred[:, i]))
        r2 = r2_score(y_test[:, i], y_pred[:, i])
        mae = np.mean(np.abs(y_test[:, i] - y_pred[:, i]))
        
        # MAPE (Mean Absolute Percentage Error)
        mape = np.mean(np.abs((y_test[:, i] - y_pred[:, i]) / (y_test[:, i] + 1e-8))) * 100
        
        # Médiane de l'erreur absolue (robuste aux outliers)
        median_ae = np.median(np.abs(y_test[:, i] - y_pred[:, i]))
        
        logger.info(f"  {target:12s} - RMSE: {rmse:7.2f} | MAE: {mae:7.2f} | R²: {r2:6.3f} | MAPE: {mape:5.2f}%")
        resultats[target] = {'rmse': rmse, 'mae': mae, 'r2': r2, 'mape': mape, 'median_ae': median_ae}
    
    # Feature importance (top 15)
    logger.info("\n🔍 TOP 15 FEATURES IMPORTANTES:")
    importances = []
    for estimator in model.estimators_:
        rf_imp = estimator.named_estimators_['rf'].feature_importances_
        gb_imp = estimator.named_estimators_['gb'].feature_importances_
        # Moyenne pondérée selon les poids du voting
        importances.append((rf_imp * 1.0 + gb_imp * 1.2) / 2.2)
    
    mean_importances = np.mean(importances, axis=0)
    feature_importance = sorted(zip(feature_cols, mean_importances), key=lambda x: x[1], reverse=True)
    
    for feat, imp in feature_importance[:15]:
        logger.info(f"  {feat:25s} : {imp:.4f}")
    
    return resultats


def sauvegarder_modele(model, scaler, salle_encoder, sensor_encoder, feature_cols, model_dir):
    """Sauvegarde le modèle et artifacts"""
    model_dir.mkdir(parents=True, exist_ok=True)
    
    joblib.dump(model, model_dir / "generic_multi_output.joblib")
    joblib.dump(scaler, model_dir / "generic_scaler.joblib")
    joblib.dump(salle_encoder, model_dir / "salle_encoder.joblib")
    joblib.dump(sensor_encoder, model_dir / "capteur_encoder.joblib")
    
    config = {
        "model_type": "voting_multi_output",
        "feature_columns": feature_cols,
        "target_columns": TARGETS,
        "trained_rooms": list(salle_encoder.classes_),
        "trained_sensors": list(sensor_encoder.classes_)
    }
    
    with open(model_dir / "generic_training_config.json", 'w') as f:
        json.dump(config, f, indent=2)
    
    logger.info(f"💾 Modèle sauvegardé: {model_dir}")


def main(with_influxdb=False):
    """Entraînement principal"""
    logger.info("="*60)
    logger.info("🚀 ENTRAÎNEMENT MODÈLE IAQ")
    if with_influxdb:
        logger.info("📊 Mode: CSV + InfluxDB (réentraînement)")
    else:
        logger.info("📊 Mode: CSV uniquement")
    logger.info("="*60)
    
    # Chemins
    base_dir = Path(__file__).parent.parent.parent
    csv_path = base_dir / "assets/datasets/ml_data/dataset_ml_5min.csv"
    model_dir = base_dir / "assets/ml_models"
    
    if not csv_path.exists():
        logger.error(f"❌ Dataset non trouvé: {csv_path}")
        return
    
    # 1. Charger données CSV
    df_csv = charger_dataset_csv(csv_path)
    
    # 2. Combiner avec InfluxDB si demandé
    if with_influxdb:
        df_influx = recuperer_donnees_influxdb()
        if not df_influx.empty:
            df = pd.concat([df_csv, df_influx], ignore_index=True)
            df = df.drop_duplicates(subset=['timestamp', 'sensor_id'])
            df = df.sort_values('timestamp')
            logger.info(f"📊 Dataset combiné: {len(df)} lignes")
        else:
            df = df_csv
    else:
        df = df_csv
    
    # 3. Créer features
    df, salle_encoder, sensor_encoder = creer_features(df)
    
    # 4. Préparer X, y
    X, y, feature_cols = preparer_donnees_entrainement(df)
    
    # 5. Normaliser
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # 6. Split temporel (85/15 pour plus de données d'entraînement)
    split_idx = int(len(X_scaled) * 0.85)
    X_train = X_scaled[:split_idx]
    X_test = X_scaled[split_idx:]
    y_train = y[:split_idx]
    y_test = y[split_idx:]
    
    logger.info(f"🔀 Split temporel (85/15) - Train: {len(X_train)} | Test: {len(X_test)}")
    
    # 7. Entraîner
    model = entrainer_modele(X_train, y_train)
    
    # 8. Évaluer
    evaluer_modele(model, X_test, y_test, feature_cols)
    
    # 9. Sauvegarder
    sauvegarder_modele(model, scaler, salle_encoder, sensor_encoder, feature_cols, model_dir)
    
    logger.info("\n✅ ENTRAÎNEMENT TERMINÉ!")
    logger.info("="*60)


if __name__ == "__main__":
    import sys
    with_influx = "--with-influxdb" in sys.argv
    main(with_influxdb=with_influx)
