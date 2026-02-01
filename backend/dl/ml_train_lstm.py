"""
Script d'entraînement MLOps pour modèle LSTM (Qualité de l'air).

Ce script :
1. Charge les données (CSV + InfluxDB)
2. Prépare les séquences temporelles (fenêtres glissantes)
3. Utilise Optuna pour trouver les meilleurs hyperparamètres (nombre de neurones, learning rate, etc.)
4. Enregistre les expériences et le modèle final dans MLflow

Usage:
    python ml_train_lstm.py --trials 10 --epochs 20
ou via Docker:
    docker exec -it iaqverse-ml-scheduler python /app/backend/ml/ml_train_lstm.py --trials 10 --epochs 20
"""


import argparse
import json
import logging
import os
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import mlflow
import mlflow.tensorflow
import numpy as np
import optuna
import pandas as pd
import requests
import tensorflow as tf
from optuna.integration.mlflow import MLflowCallback  # noqa: F401
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input
from tensorflow.keras.models import Sequential
from tensorflow.keras.optimizers import Adam

# Configuration Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration Globale
LOOKBACK_STEPS = 72       # 6h d'historique (72 * 5min) : Compromis idéal entre contexte et réactivité
HORIZON_STEPS = 6         # On veut prédire jusqu'à +30min
# Pour forcer l'anticipation, on va entrainer le modèle à prédire DIRECTEMENT le saut à +6
# sans passer par les étapes intermédiaires dans la loss function principale au début.

# Ajout des features temporelles cycliques
FEATURES = [
    "co2", "pm25", "tvoc", "temperature", "humidity", "occupants",
    "hour_sin", "hour_cos", "day_sin", "day_cos"
]
TARGETS = ["co2", "pm25", "tvoc", "temperature", "humidity"]

# MLflow Setup sur le serveur Docker
MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
mlflow.set_tracking_uri(MLFLOW_URI)

# Gestion robuste de l'expérience MLflow (création ou récupération)
experiment_name = "IAQ_LSTM_Prediction"
try:
    # Créer l'expérience si elle n'existe pas
    if not mlflow.get_experiment_by_name(experiment_name):
        mlflow.create_experiment(experiment_name)
    # Définir l'expérience active
    mlflow.set_experiment(experiment_name)
except Exception as e:
    logger.warning(f"Erreur init expérience '{experiment_name}': {e}. Fallback sur expérience par défaut.")

# Callback pour l'intégration Optuna -> MLflow (importé pour usage futur)

def load_data(csv_path):
    """Charge et nettoie les données (CSV + API si dispo)"""
    logger.info(f"Chargement des données depuis {csv_path}")
    
    # 1. Charger CSV de base
    if not os.path.exists(csv_path):
        logger.error(f"Fichier non trouvé: {csv_path}")
        return None
        
    df = pd.read_csv(csv_path)
    
    # Nettoyage basique des colonnes
    df.columns = df.columns.str.strip().str.replace('"', "")
    if "capteur_id" in df.columns:
        df = df.rename(columns={"capteur_id": "sensor_id"})
    
    # Standardisation Timestamp
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    
    # 2. (Optionnel) Récupérer nouvelles données API et fusionner AVANT le traitement
    api_url = os.getenv("API_URL", "http://localhost:8000/api/iaq/data?hours=72")
    try:
        resp = requests.get(api_url, timeout=5)
        if resp.status_code == 200:
            if json_data:= resp.json():
                df_new = pd.DataFrame(json_data)
                df_new["timestamp"] = pd.to_datetime(df_new["timestamp"], utc=True)
                
                # Concaténation
                df = pd.concat([df, df_new], ignore_index=True)
                logger.info(f"Ajouté {len(df_new)} points récents depuis l'API")
    except Exception as e:
        logger.warning(f"Impossible de récupérer les données récentes: {e}")

    # 3. Traitement Global (CSV + API)
    df = df.drop_duplicates(subset=["timestamp", "sensor_id"])
    df = df.sort_values("timestamp")
    
    # --- Feature Engineering (Temporel) ---
    # L'heure est capitale pour la qualité de l'air (bureaux ouverts/fermés, nuit/jour)
    # On utilise sin/cos pour préserver la cyclicité (23h est proche de 00h)
    df['hour_sin'] = np.sin(2 * np.pi * df['timestamp'].dt.hour / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['timestamp'].dt.hour / 24)
    
    # Le jour de la semaine est aussi important (Week-end vs Semaine)
    df['day_sin'] = np.sin(2 * np.pi * df['timestamp'].dt.dayofweek / 7)
    df['day_cos'] = np.cos(2 * np.pi * df['timestamp'].dt.dayofweek / 7)

    # Conversion numérique des autres features
    for col in FEATURES:
        if col in df.columns and col not in ['hour_sin', 'hour_cos', 'day_sin', 'day_cos']: # Deja float
            df[col] = pd.to_numeric(df[col], errors='coerce')
    
    # On s'assure que toutes les features existent (si 'occupants' manque dans CSV ou API, on met 0 par défaut)
    if 'occupants' not in df.columns:
        logger.warning("'occupants' column missing, filling with 0")
        df['occupants'] = 0.0
    else:
        df['occupants'] = df['occupants'].fillna(0)

    # Nettoyage final des NaNs
    df = df.dropna(subset=FEATURES)
    
    # --- Smoothing (Lissage) ---
    # Les données brutes capteurs sont souvent très bruitées (sauts rapides).
    # Un lissage par moyenne glissante aide le LSTM à voir la tendance réelle.
    # Fenêtre de 6 = 30 minutes (lissage plus agressif pour réduire le bruit en dents de scie)
    cols_to_smooth = ["co2", "pm25", "tvoc", "temperature", "humidity"]
    for col in cols_to_smooth:
        if col in df.columns:
            df[col] = df[col].rolling(window=6, min_periods=1).mean()

    logger.info(f"Total données après nettoyage: {len(df)} lignes")
    return df

def create_sequences(data, n_steps_in, n_steps_out):
    """Transforme une série temporelle en échantillons [X, y] pour LSTM"""
    X, y = [], []
    # Convertir en numpy array si ce n'est pas déjà le cas
    if isinstance(data, pd.DataFrame):
        data = data.values
        
    for i in range(len(data)):
        # Fin de la séquence d'entrée
        end_ix = i + n_steps_in
        # Fin de la séquence de sortie (prédiction)
        out_end_ix = end_ix + n_steps_out
        
        if out_end_ix > len(data):
            break
            
        seq_x = data[i:end_ix, :] # Tous les features
        # On suppose que les targets sont les 3 premières colonnes (CO2, PM2.5, TVOC)
        # Il faut s'assurer que l'ordre des colonnes correspond bien !
        seq_y = data[end_ix:out_end_ix, 0:len(TARGETS)] 
        
        X.append(seq_x)
        y.append(seq_y)
        
    return np.array(X), np.array(y)

def train_best_model(csv_path, n_trials=10, n_epochs=20):
    """Fonction principale du workflow"""
    
    # --- 1. Préparation des Données ---
    df = load_data(csv_path)
    if df is None:
        return  # Erreur déjà loguée
        
    if len(df) < 200:
        logger.error(f"Pas assez de données pour entraîner ({len(df)} lignes)")
        return

    # Garder uniquement les colonnes utiles dans le bon ordre
    dataset = df[FEATURES].values
    
    # --- Split Train/Test pour le Scaling (Anti-Data Leakage) ---
    # On définit le point de coupure sur les données brutes
    train_size = int(len(dataset) * 0.8)
    train_data = dataset[:train_size]
    
    # Normalisation (Fit uniquement sur le Train !)
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(train_data)
    
    # On transforme tout le dataset pour pouvoir créer les séquences (y compris à la frontière train/test)
    scaled_data = scaler.transform(dataset)
    
    # Sauvegarder le scaler pour l'inférence plus tard
    joblib.dump(scaler, "lstm_scaler.joblib")

    # Create sequences
    X, y = create_sequences(scaled_data, LOOKBACK_STEPS, HORIZON_STEPS)
    
    # Check for NaNs due to windowing/shifts
    if np.isnan(X).any() or np.isnan(y).any():
        logger.warning("NaNs detected in sequence data, cleaning...")
        valid_idx = ~np.isnan(X).any(axis=(1,2)) & ~np.isnan(y).any(axis=(1,2))
        X = X[valid_idx]
        y = y[valid_idx]
    
    # Split Train/Test (pas de shuffle pour séries temporelles !)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    
    logger.info(f"Train shape: {X_train.shape}, Test shape: {X_test.shape}")

    # --- 2. Définition de l'objectif Optuna ---
    def objective(trial):
        with mlflow.start_run(nested=True, run_name=f"Trial_{trial.number}"):
            # Hyperparamètres à tester
            # Augmentation de la capacité du modèle et réduction drastique du dropout
            # car le modèle "sous-apprenait" (prédiction plate)
            lstm_units = trial.suggest_int("lstm_units", 64, 256) # Min 64 unités
            n_layers = trial.suggest_int("n_layers", 2, 4)        # Au moins 2 couches pour capter la complexité
            # Dropout très faible voire nul pour laisser le modèle mémoriser les patterns fins
            dropout_rate = trial.suggest_float("dropout_rate", 0.0, 0.15) # Max 15% de dropout
            learning_rate = trial.suggest_float("learning_rate", 1e-4, 5e-3, log=True)
            
            # Log params explicitement dans le run enfant
            mlflow.log_params(trial.params)

            # Architecture du Modèle
            # Utilisation d'une structure Encoder-Decoder ou simplement LSTM simple mais robuste
            model = Sequential()
            model.add(Input(shape=(LOOKBACK_STEPS, len(FEATURES))))

            # Couches LSTM
            for i in range(n_layers):
                return_sequences = i < n_layers - 1 # True sauf pour la derniere couche LSTM
                
                model.add(LSTM(
                    lstm_units,
                    activation="tanh",
                    return_sequences=return_sequences
                ))
                model.add(Dropout(dropout_rate))
            
            # --- Modification architecture pour sortie multi-steps ---
            # Au lieu de Reshape, on utilise Dense directement pour mapper l'état caché final 
            # vers l'ensemble des points futurs d'un coup.
            model.add(Dense(HORIZON_STEPS * len(TARGETS)))
            model.add(tf.keras.layers.Reshape((HORIZON_STEPS, len(TARGETS))))

            # Optimiseur avec Learning Rate Decay pour affiner la fin de l'entrainement
            # Modification: Metrics MeanAbsoluteError pour être moins sensible aux outliers que MSE
            model.compile(
                optimizer=Adam(learning_rate=learning_rate, clipnorm=1.0),
                loss="mse", 
                metrics=["mae"]
            )
            
            try:
                # Entraînement rapide pour la recherche
                history = model.fit(
                    X_train, 
                    y_train, 
                    epochs=10, # Peu d'epochs pour la recherche
                    batch_size=32,
                    validation_data=(X_test, y_test),
                    verbose=0
                )
                
                val_loss = history.history['val_loss'][-1]
                
                # Log metrics pour ce trial
                mlflow.log_metric("val_loss", val_loss)
                mlflow.log_metric("train_loss", history.history["loss"][-1])

                # Log artifact léger pour ce trial (courbe loss)
                plt.figure(figsize=(6, 4))
                plt.plot(history.history["loss"], label="Train")
                plt.plot(history.history["val_loss"], label="Val")
                plt.title(f"Trial {trial.number} Loss")
                plt.legend()
                filename = f"trial_{trial.number}_loss.png"
                plt.savefig(filename)
                plt.close()
                mlflow.log_artifact(filename)
                
                return float("inf") if np.isnan(val_loss) else val_loss
            except Exception as e:
                logger.warning(f"Trial failed: {e}")
                return float("inf")

    # --- 3. Lancer l'optimisation ---
    logger.info("Début de l'optimisation des hyperparamètres...")
    
    # On encapsule l'étude Optuna dans un Run Parent MLflow pour regrouper tous les essais
    with mlflow.start_run(run_name="Optuna_Optimization", nested=True):
        study = optuna.create_study(direction='minimize')
        study.optimize(objective, n_trials=n_trials)
        
        best_params = study.best_params
        logger.info(f"Meilleurs paramètres trouvés: {best_params}")
        
        # Log des meilleurs params dans le run parent
        mlflow.log_params(best_params)

    # --- 4. Réentraînement complet et Login MLflow ---
    # S'assurer qu'aucun run n'est actif
    if mlflow.active_run():
        mlflow.end_run()
        
    with mlflow.start_run(run_name="Best_Model_Training") as run:
        # Log params
        mlflow.log_params(best_params)
        mlflow.log_param("lookback_steps", LOOKBACK_STEPS)
        mlflow.log_param("horizon_steps", HORIZON_STEPS)
        
        model = Sequential()
        n_layers = best_params.get("n_layers", 1)
        model.add(Input(shape=(LOOKBACK_STEPS, len(FEATURES))))

        for i in range(n_layers):
            return_sequences = i < n_layers - 1
            model.add(
                LSTM(
                    best_params["lstm_units"],
                    activation="tanh",
                    return_sequences=return_sequences,
                )
            )
            model.add(Dropout(best_params["dropout_rate"]))

        model.add(Dense(HORIZON_STEPS * len(TARGETS)))
        model.add(tf.keras.layers.Reshape((HORIZON_STEPS, len(TARGETS))))

        model.compile(
            optimizer=Adam(
                learning_rate=best_params["learning_rate"],
                clipnorm=1.0,
            ),
            loss="mse",
            metrics=["mae"],
        )
        
        # Entraînement complet
        # On augmente un peu la patience pour laisser le temps au modèle d'apprendre les patterns complexes
        early_stop = EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True)
        
        # Scheduler pour réduire le learning rate sur un plateau
        reduce_lr = tf.keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6
        )

        history = model.fit(
            X_train, y_train,
            epochs=n_epochs,
            batch_size=32,
            validation_data=(X_test, y_test),
            callbacks=[early_stop, reduce_lr],
            verbose=1
        )
        
        # Log metrics finales
        loss = history.history['loss'][-1]
        val_loss = history.history['val_loss'][-1]
        mlflow.log_metric("final_train_loss", loss)
        mlflow.log_metric("final_val_loss", val_loss)
        
        # --- Génération de graphiques ---
        # 1. Courbe de Loss
        plt.figure(figsize=(10, 6))
        plt.plot(history.history['loss'], label='Train Loss')
        plt.plot(history.history['val_loss'], label='Validation Loss')
        plt.title("Courbe d'apprentissage (Loss)")
        plt.xlabel('Epochs')
        plt.ylabel('MSE (Normalisé)')
        plt.legend()
        plt.savefig("loss_curve.png")
        plt.close()
        mlflow.log_artifact("loss_curve.png")

        # 2. Exemple de Prédiction (Sur données normalisées)
        # On prédit sur tout le X_test pour avoir de la matière
        y_pred = model.predict(X_test)
        
        # Création d'une figure avec 1 colonne (Superposition) et N lignes (targets)
        num_targets = len(TARGETS)
        
        fig, axes = plt.subplots(num_targets, 1, figsize=(15, 6 * num_targets), sharex=True)
        if num_targets == 1:
            axes = [axes] # Assurer itérable

        for i, target_name in enumerate(TARGETS):
            ax = axes[i]
            
            # Récupération Scaling
            try:
                feat_idx = FEATURES.index(target_name)
                data_min = scaler.data_min_[feat_idx]
                data_range = scaler.data_range_[feat_idx]
            except ValueError:
                data_min = 0
                data_range = 1
            
            # On superpose les prédictions court/long terme pour comparer le lag
            # Horizon 30 min (Index 5)
            step_30 = 5
            if step_30 < HORIZON_STEPS:
                y_test_30 = y_test[:200, step_30, i] * data_range + data_min
                y_pred_30 = y_pred[:200, step_30, i] * data_range + data_min
                
                ax.plot(y_test_30, label='Réel (t+30m)', color='#1f77b4', linewidth=1.5, alpha=0.7)
                ax.plot(y_pred_30, label='Prédit (t+30m)', color='#ff7f0e', linewidth=2)
            
            ax.set_title(f"{target_name} - Prédiction à Horizon +30min")
            ax.legend()
            ax.grid(True, alpha=0.3)

        plt.tight_layout()
        plt.savefig("prediction_sample.png")
        plt.close()
        mlflow.log_artifact("prediction_sample.png")

        # --- Définition de la Signature et de l'Exemple d'Input (Pour MLflow UI) ---
        from mlflow.models import infer_signature

        # On prend un petit échantillon des données de test pour l'exemple
        input_example = X_test[:5]
        prediction_example = model.predict(input_example)

        # Inférer la signature (Schema Input -> Schema Output)
        signature = infer_signature(input_example, prediction_example)
        
        # Sauvegarde du modèle dans MLflow avec Signature et Exemple
        # 'tf' flavor pour TensorFlow/Keras
        # Note: Utilisation de 'name' au lieu de 'artifact_path' pour éviter les warnings de dépréciation
        mlflow.tensorflow.log_model(
            model=model, 
            name="model",
            registered_model_name="IAQ_LSTM_Model",
            signature=signature,
            input_example=input_example
        )
        
        # Sauvegarder aussi le scaler dans ce run spécifique
        mlflow.log_artifact("lstm_scaler.joblib")
        
        # --- 5. Export pour la Production (Fichiers locaux) ---
        # C'est ce fichier que l'API de prédiction va charger pour être rapide et autonome
        # On utilise un chemin relatif à ce script pour être robuste (marche en local et Docker)
        # Script dans: backend/ml/
        # Models dans: assets/ml_models/
        project_root = Path(__file__).resolve().parent.parent.parent
        prod_path = project_root / "assets/ml_models"
        prod_path.mkdir(parents=True, exist_ok=True)
        
        model.save(prod_path / "lstm_model.keras")
        joblib.dump(scaler, prod_path / "lstm_scaler.joblib")
        
        # Sauvegarder la config pour que le prédicteur sache quoi faire
        config = {
            "model_type": "lstm",
            "features": FEATURES,
            "targets": TARGETS,
            "lookback": LOOKBACK_STEPS,
            "horizon": HORIZON_STEPS,
        }
        with open(prod_path / "lstm_config.json", "w") as f:
            json.dump(config, f)
            
        logger.info(f"Modèle de production exporté vers {prod_path}")
        logger.info(f"Modèle entraîné et logué dans MLflow (Run ID: {run.info.run_id})")

if __name__ == "__main__":
    # Chemin par défaut robuste (relatif au script)
    default_csv = Path(__file__).resolve().parent.parent.parent / "assets/datasets/ml_data/dataset_ml_5min.csv"
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=str(default_csv), help="Chemin vers le CSV")
    parser.add_argument("--trials", type=int, default=5, help="Nombre d'essais Optuna")
    parser.add_argument("--epochs", type=int, default=20, help="Nombre d'epochs max")
    args = parser.parse_args()
    
    train_best_model(args.csv, args.trials, args.epochs)
