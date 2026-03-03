"""
Script d'entraînement MLOps pour modèle LSTM (Qualité de l'air).

Ce script :
1. Charge les données (CSV + InfluxDB)
2. Prépare les séquences temporelles **par capteur** (fenêtres glissantes)
3. Utilise Optuna (persistant SQLite) pour trouver les meilleurs hyperparamètres
   → Chaque exécution ajoute N trials à l'étude existante (cumul jour après jour)
4. Réentraîne le meilleur modèle uniquement si de meilleurs params sont trouvés
5. Enregistre les expériences et le modèle final dans MLflow

Usage quotidien (CPU, ~2-3 trials/jour) :
    python ml_train_lstm.py --trials 2 --epochs 30
Forcer un réentraînement complet :
    python ml_train_lstm.py --trials 0 --epochs 50 --force-retrain
Voir l'état de l'étude Optuna :
    python ml_train_lstm.py --show-study
ou via Docker :
    docker exec -it iaqverse-ml-scheduler python /app/backend/dl/ml_train_lstm.py --trials 2 --epochs 30
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
import seaborn as sns
import tensorflow as tf
from optuna.integration.mlflow import MLflowCallback  # noqa: F401
from scipy.stats import pearsonr
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras.layers import (
    LSTM,
    Attention,
    Concatenate,
    Dense,
    Dropout,
    Input,
    RepeatVector,
    TimeDistributed,
)
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam

# Configuration Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────
# Configuration Globale
# ──────────────────────────────────────────────────────────────
LOOKBACK_STEPS = 72  # 6 h d'historique (72 × 5 min)
HORIZON_STEPS = 6  # Prédire +5 min … +30 min (6 pas × 5 min)

# Optuna persistant : fichier SQLite partagé entre exécutions
# En prod Docker, /app/assets/ml_models est un volume persistant → la DB survit aux redéploiements
# En local, on tombe dans assets/ml_models du projet
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_PERSISTENT_DIR = _PROJECT_ROOT / "assets" / "ml_models"
_PERSISTENT_DIR.mkdir(parents=True, exist_ok=True)
OPTUNA_DB_PATH = _PERSISTENT_DIR / "optuna_lstm_study.db"
OPTUNA_STUDY_NAME = "IAQ_LSTM_HPO"

# Seuil : nombre minimum de trials cumulés avant de considérer l'étude fiable
MIN_TRIALS_FOR_BEST = 6

# Features d'entrée (incluant features temporelles cycliques)
FEATURES = [
    "co2",
    "pm25",
    "tvoc",
    "temperature",
    "humidity",
    "occupants",
    "hour_sin",
    "hour_cos",
    "day_sin",
    "day_cos",
]
TARGETS = ["co2", "pm25", "tvoc", "temperature", "humidity"]

# MLflow Setup
MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
mlflow.set_tracking_uri(MLFLOW_URI)

experiment_name = "IAQ_LSTM_Prediction_v2"
try:
    if not mlflow.get_experiment_by_name(experiment_name):
        mlflow.create_experiment(experiment_name)
    mlflow.set_experiment(experiment_name)
except Exception as e:
    logger.warning(
        f"Erreur init expérience '{experiment_name}': {e}. Fallback sur expérience par défaut."
    )


# ──────────────────────────────────────────────────────────────
#  Notification rechargement modèle au backend
# ──────────────────────────────────────────────────────────────
_BACKEND_RELOAD_URL = os.getenv("BACKEND_RELOAD_URL", "http://backend:8000/api/reload-model")


def _notify_backend_reload():
    """Appelle le backend pour qu'il recharge le nouveau modèle en mémoire."""
    import requests

    try:
        resp = requests.post(_BACKEND_RELOAD_URL, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            logger.info(f"✅ Backend notifié — modèle rechargé (type={data.get('model_type')})")
        else:
            logger.warning(f"⚠️ Backend a répondu {resp.status_code}: {resp.text}")
    except requests.ConnectionError:
        logger.warning(
            f"⚠️ Backend injoignable à {_BACKEND_RELOAD_URL} — "
            "le modèle sera rechargé au prochain redémarrage du backend."
        )
    except Exception as e:
        logger.warning(f"⚠️ Erreur lors de la notification du backend: {e}")


# ──────────────────────────────────────────────────────────────
#  Chargement & Préparation des données
# ──────────────────────────────────────────────────────────────
def load_data(csv_path: str) -> pd.DataFrame | None:
    """Charge et nettoie les données (CSV + API si dispo).

    Retourne un DataFrame trié par (sensor_id, timestamp) avec features
    temporelles cycliques déjà calculées.
    """
    logger.info(f"Chargement des données depuis {csv_path}")

    if not os.path.exists(csv_path):
        logger.error(f"Fichier non trouvé: {csv_path}")
        return None

    df = pd.read_csv(csv_path)

    # --- Nettoyage colonnes ---
    df.columns = df.columns.str.strip().str.replace('"', "")
    if "capteur_id" in df.columns:
        df = df.rename(columns={"capteur_id": "sensor_id"})

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)

    # --- (Optionnel) Récupérer nouvelles données API ---
    api_url = os.getenv(
        "API_URL",
        f"http://localhost:8000/api/iaq/data?hours={LOOKBACK_STEPS * 5 / 60}",
    )
    try:
        resp = requests.get(api_url, timeout=5)
        if resp.status_code == 200:
            if json_data := resp.json():
                df_new = pd.DataFrame(json_data)
                df_new["timestamp"] = pd.to_datetime(df_new["timestamp"], utc=True)
                df = pd.concat([df, df_new], ignore_index=True)
                logger.info(f"Ajouté {len(df_new)} points récents depuis l'API")
    except Exception as e:
        logger.warning(f"Impossible de récupérer les données récentes: {e}")

    # --- Déduplication & Tri PAR CAPTEUR puis par timestamp ---
    df = df.drop_duplicates(subset=["timestamp", "sensor_id"])
    df = df.sort_values(["sensor_id", "timestamp"]).reset_index(drop=True)

    # --- Feature Engineering (Temporel cyclique) ---
    df["hour_sin"] = np.sin(2 * np.pi * df["timestamp"].dt.hour / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["timestamp"].dt.hour / 24)
    df["day_sin"] = np.sin(2 * np.pi * df["timestamp"].dt.dayofweek / 7)
    df["day_cos"] = np.cos(2 * np.pi * df["timestamp"].dt.dayofweek / 7)

    # --- Conversion numérique ---
    for col in FEATURES:
        if col in df.columns and col not in ("hour_sin", "hour_cos", "day_sin", "day_cos"):
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "occupants" not in df.columns:
        logger.warning("'occupants' column missing, filling with 0")
        df["occupants"] = 0.0
    else:
        df["occupants"] = df["occupants"].fillna(0)

    df = df.dropna(subset=FEATURES)

    # --- Lissage PAR CAPTEUR (très important !) ---
    cols_to_smooth = ["co2", "pm25", "tvoc", "temperature", "humidity"]
    for col in cols_to_smooth:
        if col in df.columns:
            df[col] = df.groupby("sensor_id")[col].transform(
                lambda s: s.rolling(window=6, min_periods=1).mean()
            )

    logger.info(f"Total données après nettoyage: {len(df)} lignes")
    logger.info(f"Capteurs: {df['sensor_id'].unique().tolist()}")
    return df


# ──────────────────────────────────────────────────────────────
#  Création des séquences PAR CAPTEUR
# ──────────────────────────────────────────────────────────────
def create_sequences(data: np.ndarray, n_steps_in: int, n_steps_out: int):
    """Fenêtres glissantes sur une série temporelle UNIQUE (un capteur)."""
    X, y = [], []
    for i in range(len(data) - n_steps_in - n_steps_out + 1):
        end_ix = i + n_steps_in
        out_end_ix = end_ix + n_steps_out
        seq_x = data[i:end_ix, :]  # toutes les features
        seq_y = data[end_ix:out_end_ix, : len(TARGETS)]  # seulement les targets
        X.append(seq_x)
        y.append(seq_y)
    return np.array(X), np.array(y)


def build_sequences_per_sensor(
    df: pd.DataFrame, scaler: MinMaxScaler, n_in: int, n_out: int
):
    """Crée les séquences en respectant les frontières de chaque capteur.

    Seul le capteur ayant le plus de données est utilisé pour l'entraînement
    afin d'éviter un biais dû au déséquilibre entre capteurs.
    """
    all_X, all_y = [], []
    best_sensor, best_count = None, 0

    for sensor_id, grp in df.groupby("sensor_id"):
        arr = grp[FEATURES].values
        scaled = scaler.transform(arr)
        Xs, ys = create_sequences(scaled, n_in, n_out)
        if len(Xs) > 0:
            logger.info(f"  Capteur {sensor_id}: {len(Xs)} séquences")
            if len(Xs) > best_count:
                best_sensor, best_count = sensor_id, len(Xs)
            all_X.append((sensor_id, Xs))
            all_y.append((sensor_id, ys))

    # Ne garder que le capteur principal
    logger.info(f"  → Capteur retenu: {best_sensor} ({best_count} séquences)")
    X = next(Xs for sid, Xs in all_X if sid == best_sensor)
    y = next(ys for sid, ys in all_y if sid == best_sensor)
    return X, y


# ──────────────────────────────────────────────────────────────
#  Architecture du modèle  –  Encoder-Decoder avec Attention
# ──────────────────────────────────────────────────────────────
def build_model(
    lstm_units: int,
    n_layers: int,
    dropout_rate: float,
    learning_rate: float,
    n_features: int = len(FEATURES),
    n_targets: int = len(TARGETS),
    lookback: int = LOOKBACK_STEPS,
    horizon: int = HORIZON_STEPS,
    use_attention: bool = True,
):
    """Construit un modèle Encoder-Decoder LSTM avec attention optionnelle.

    Encoder : empile n_layers LSTM sur la fenêtre d'entrée (lookback)
    Decoder : RepeatVector + LSTM (+ Attention sur les hidden states encoder)
    Sortie  : TimeDistributed Dense → (horizon, n_targets)
    """
    # --- Encoder ---
    encoder_input = Input(shape=(lookback, n_features), name="encoder_input")
    x = encoder_input

    for i in range(n_layers):
        x = LSTM(
            lstm_units,
            activation="tanh",
            return_sequences=True,
            name=f"encoder_lstm_{i}",
        )(x)
        x = Dropout(dropout_rate)(x)

    encoder_outputs = x  # (batch, lookback, lstm_units)
    encoder_last = x[:, -1, :]  # (batch, lstm_units)

    # --- Decoder ---
    decoder_input = RepeatVector(horizon)(encoder_last)  # (batch, horizon, lstm_units)

    decoder_lstm = LSTM(
        lstm_units,
        activation="tanh",
        return_sequences=True,
        name="decoder_lstm",
    )(decoder_input)
    decoder_lstm = Dropout(dropout_rate)(decoder_lstm)

    if use_attention:
        attn_out = Attention(name="attention")([decoder_lstm, encoder_outputs])
        decoder_combined = Concatenate()([decoder_lstm, attn_out])
    else:
        decoder_combined = decoder_lstm

    # --- Sortie multi-step multi-target ---
    output = TimeDistributed(Dense(n_targets), name="output")(decoder_combined)

    model = Model(inputs=encoder_input, outputs=output, name="LSTM_Encoder_Decoder")

    model.compile(
        optimizer=Adam(learning_rate=learning_rate, clipnorm=1.0),
        loss="huber",  # Huber loss : robuste aux outliers, meilleur que MSE pur
        metrics=["mae"],
    )
    return model


# ──────────────────────────────────────────────────────────────
#  Helpers Optuna persistant
# ──────────────────────────────────────────────────────────────
def _get_optuna_storage():
    """Retourne un storage SQLite persistant pour Optuna."""
    return optuna.storages.RDBStorage(
        url=f"sqlite:///{OPTUNA_DB_PATH}",
        engine_kwargs={"connect_args": {"timeout": 30}},
    )


def _load_or_create_study():
    """Charge l'étude existante ou en crée une nouvelle."""
    storage = _get_optuna_storage()
    study = optuna.create_study(
        study_name=OPTUNA_STUDY_NAME,
        storage=storage,
        direction="minimize",
        load_if_exists=True,  # ← Clé : reprend les trials précédents
    )
    return study


# ──────────────────────────────────────────────────────────────
#  Workflow principal
# ──────────────────────────────────────────────────────────────
def train_best_model(
    csv_path: str,
    n_trials: int = 2,
    n_epochs: int = 30,
    force_retrain: bool = False,
):
    """Pipeline incrémental : data → Optuna (+N trials) → meilleur modèle → MLflow.

    Grâce au stockage SQLite, chaque exécution quotidienne ajoute `n_trials`
    essais à l'étude Optuna existante. Le modèle n'est réentraîné que si :
      - force_retrain est True, OU
      - le nombre total de trials atteint MIN_TRIALS_FOR_BEST, OU
      - de meilleurs hyperparamètres ont été trouvés lors de cette session.
    """

    # ── 1. Préparation des données ───────────────────────────
    df = load_data(csv_path)
    if df is None:
        return

    if len(df) < 500:
        logger.error(f"Pas assez de données pour entraîner ({len(df)} lignes)")
        return

    # --- Scaler : fit uniquement sur les 80 % premiers de chaque capteur ---
    train_frames = []
    for sensor_id, grp in df.groupby("sensor_id"):
        n_train = int(len(grp) * 0.8)
        train_frames.append(grp.iloc[:n_train])

    train_df = pd.concat(train_frames)
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(train_df[FEATURES].values)
    joblib.dump(scaler, "lstm_scaler.joblib")

    # --- Séquences par capteur ---
    logger.info("Création des séquences par capteur…")
    X, y = build_sequences_per_sensor(df, scaler, LOOKBACK_STEPS, HORIZON_STEPS)

    # Nettoyage NaN éventuels
    if np.isnan(X).any() or np.isnan(y).any():
        logger.warning("NaNs détectés, nettoyage…")
        valid = ~np.isnan(X).any(axis=(1, 2)) & ~np.isnan(y).any(axis=(1, 2))
        X, y = X[valid], y[valid]

    logger.info(f"Total séquences: {len(X)}")

    # Split Train/Test (pas de shuffle pour conserver l'ordre temporel)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]

    logger.info(f"Train: {X_train.shape} | Test: {X_test.shape}")

    # ── 2. Optuna incrémental (persistant SQLite) ────────────
    # Sous-échantillonnage pour accélérer les trials sur CPU
    # On prend 1 séquence sur 3 pour les trials (le modèle final utilise tout)
    subsample = max(1, len(X_train) // 3)
    X_trial = X_train[::3][:subsample]
    y_trial = y_train[::3][:subsample]
    logger.info(
        f"Sous-échantillon Optuna: {X_trial.shape[0]} séquences "
        f"(sur {X_train.shape[0]})"
    )

    # Charger l'étude existante
    study = _load_or_create_study()
    prev_best = study.best_value if len(study.trials) > 0 else float("inf")
    prev_n_trials = len(study.trials)
    logger.info(
        f"Étude Optuna '{OPTUNA_STUDY_NAME}': {prev_n_trials} trials existants, "
        f"meilleur val_loss = {prev_best:.6f}"
    )

    def objective(trial):
        # Hyperparamètres à explorer
        lstm_units = trial.suggest_int("lstm_units", 64, 256, step=32)
        n_layers = trial.suggest_int("n_layers", 2, 4)
        dropout_rate = trial.suggest_float("dropout_rate", 0.0, 0.15)
        learning_rate = trial.suggest_float("learning_rate", 1e-4, 5e-3, log=True)
        use_attention = trial.suggest_categorical("use_attention", [True, False])

        model = build_model(
            lstm_units=lstm_units,
            n_layers=n_layers,
            dropout_rate=dropout_rate,
            learning_rate=learning_rate,
            use_attention=use_attention,
        )

        try:
            early_stop = EarlyStopping(
                monitor="val_loss", patience=4, restore_best_weights=True
            )
            history = model.fit(
                X_trial,
                y_trial,
                epochs=10,  # Peu d'epochs pour la recherche sur CPU
                batch_size=128,  # Gros batch = moins d'itérations
                validation_data=(X_test, y_test),
                callbacks=[early_stop],
                verbose=0,  # Silencieux pour ne pas polluer les logs
            )

            val_loss = history.history["val_loss"][-1]
            logger.info(
                f"  Trial {trial.number} → val_loss={val_loss:.6f} "
                f"(units={lstm_units}, layers={n_layers}, lr={learning_rate:.5f}, "
                f"attn={use_attention})"
            )
            return float("inf") if np.isnan(val_loss) else val_loss

        except Exception as e:
            logger.warning(f"Trial {trial.number} failed: {e}")
            return float("inf")

    # Lancer les nouveaux trials (s'ajoutent aux précédents dans la DB)
    if n_trials > 0:
        logger.info(f"Lancement de {n_trials} nouveaux trials Optuna…")
        study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    total_trials = len(study.trials)
    new_best = study.best_value if total_trials > 0 else float("inf")
    best_params = study.best_params if total_trials > 0 else None

    logger.info(f"Total trials cumulés: {total_trials}")
    logger.info(f"Meilleur val_loss global: {new_best:.6f}")
    logger.info(f"Meilleurs params: {best_params}")

    # ── 3. Décider si on réentraîne le modèle complet ────────
    should_retrain = force_retrain

    if not should_retrain and best_params is None:
        logger.warning("Aucun trial réussi dans l'étude, pas de réentraînement.")
        return

    if not should_retrain and total_trials < MIN_TRIALS_FOR_BEST:
        logger.info(
            f"Seulement {total_trials}/{MIN_TRIALS_FOR_BEST} trials cumulés. "
            f"Pas encore assez pour un réentraînement complet. Rendez-vous demain !"
        )
        return

    if not should_retrain:
        # On réentraîne si on a trouvé mieux OU si c'est la première fois
        # qu'on atteint le seuil MIN_TRIALS_FOR_BEST
        improved = new_best < prev_best
        first_threshold = prev_n_trials < MIN_TRIALS_FOR_BEST <= total_trials
        should_retrain = improved or first_threshold

        if improved:
            logger.info(
                f"Amélioration détectée! {prev_best:.6f} → {new_best:.6f} "
                f"(Δ = {prev_best - new_best:.6f})"
            )
        elif first_threshold:
            logger.info(
                f"Seuil de {MIN_TRIALS_FOR_BEST} trials atteint, "
                f"premier entraînement complet."
            )
        else:
            logger.info(
                f"Pas d'amélioration (best={new_best:.6f}). "
                f"Modèle existant conservé. Prochaine tentative demain."
            )
            return

    # ── 4. Réentraînement complet avec les meilleurs params ──
    if mlflow.active_run():
        mlflow.end_run()

    with mlflow.start_run(run_name="Best_Model_Training") as run:
        mlflow.log_params(best_params)
        mlflow.log_param("lookback_steps", LOOKBACK_STEPS)
        mlflow.log_param("horizon_steps", HORIZON_STEPS)
        mlflow.log_param("total_optuna_trials", total_trials)

        model = build_model(
            lstm_units=best_params["lstm_units"],
            n_layers=best_params.get("n_layers", 2),
            dropout_rate=best_params["dropout_rate"],
            learning_rate=best_params["learning_rate"],
            use_attention=best_params.get("use_attention", True),
        )

        model.summary(print_fn=logger.info)

        early_stop = EarlyStopping(
            monitor="val_loss", patience=10, restore_best_weights=True
        )
        reduce_lr = tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=7, min_lr=1e-6
        )

        history = model.fit(
            X_train,
            y_train,
            epochs=n_epochs,
            batch_size=64,
            validation_data=(X_test, y_test),
            callbacks=[early_stop, reduce_lr],
            verbose=1,
        )

        # ── Métriques finales ────────────────────────────────
        loss = history.history["loss"][-1]
        val_loss = history.history["val_loss"][-1]
        mlflow.log_metric("final_train_loss", loss)
        mlflow.log_metric("final_val_loss", val_loss)

        y_pred_full = model.predict(X_test)

        # --- Dénormalisation ---
        y_test_denorm = np.zeros_like(y_test)
        y_pred_denorm = np.zeros_like(y_pred_full)

        for i, target_name in enumerate(TARGETS):
            try:
                feat_idx = FEATURES.index(target_name)
                data_min = scaler.data_min_[feat_idx]
                data_range = scaler.data_range_[feat_idx]
                y_test_denorm[:, :, i] = y_test[:, :, i] * data_range + data_min
                y_pred_denorm[:, :, i] = y_pred_full[:, :, i] * data_range + data_min
            except ValueError:
                y_test_denorm[:, :, i] = y_test[:, :, i]
                y_pred_denorm[:, :, i] = y_pred_full[:, :, i]

        # --- Métriques par target à t+30 min ---
        horizon_idx = min(5, HORIZON_STEPS - 1)
        for i, target_name in enumerate(TARGETS):
            y_true = y_test_denorm[:, horizon_idx, i]
            y_pred = y_pred_denorm[:, horizon_idx, i]

            mae = mean_absolute_error(y_true, y_pred)
            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            r2 = r2_score(y_true, y_pred)
            corr, _ = pearsonr(y_true, y_pred)

            mask = y_true > 0
            mape = (
                np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
                if mask.sum() > 0
                else 0
            )

            if len(y_true) > 1:
                true_dir = np.diff(y_true) > 0
                pred_dir = np.diff(y_pred) > 0
                dir_acc = np.mean(true_dir == pred_dir) * 100
            else:
                dir_acc = 0

            mlflow.log_metric(f"{target_name}_mae_t30min", mae)
            mlflow.log_metric(f"{target_name}_rmse_t30min", rmse)
            mlflow.log_metric(f"{target_name}_r2_t30min", r2)
            mlflow.log_metric(f"{target_name}_correlation_t30min", corr)
            mlflow.log_metric(f"{target_name}_mape_t30min", mape)
            mlflow.log_metric(f"{target_name}_directional_accuracy", dir_acc)

        # --- Métriques par horizon ---
        for h in range(HORIZON_STEPS):
            corr_h, mae_h = [], []
            for i in range(len(TARGETS)):
                y_true = y_test_denorm[:, h, i]
                y_pred = y_pred_denorm[:, h, i]
                c, _ = pearsonr(y_true, y_pred)
                corr_h.append(c)
                mae_h.append(mean_absolute_error(y_true, y_pred))
            mlflow.log_metric(f"avg_correlation_t{(h+1)*5}min", np.mean(corr_h))
            mlflow.log_metric(f"avg_mae_t{(h+1)*5}min", np.mean(mae_h))

        # ── Graphiques ───────────────────────────────────────

        # 1. Courbe de loss
        plt.figure(figsize=(10, 6))
        plt.plot(history.history["loss"], label="Train Loss")
        plt.plot(history.history["val_loss"], label="Validation Loss")
        plt.title("Courbe d'apprentissage (Loss)")
        plt.xlabel("Epochs")
        plt.ylabel("Huber Loss (Normalisé)")
        plt.legend()
        plt.savefig("loss_curve.png")
        plt.close()
        mlflow.log_artifact("loss_curve.png")

        # 2. Dégradation par horizon
        horizons = [f"t+{(h+1)*5}min" for h in range(HORIZON_STEPS)]
        avg_corr_by_h, avg_mae_by_h = [], []
        for h in range(HORIZON_STEPS):
            cl, ml_ = [], []
            for i in range(len(TARGETS)):
                yt = y_test_denorm[:, h, i]
                yp = y_pred_denorm[:, h, i]
                c, _ = pearsonr(yt, yp)
                cl.append(c)
                ml_.append(mean_absolute_error(yt, yp))
            avg_corr_by_h.append(np.mean(cl))
            avg_mae_by_h.append(np.mean(ml_))

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
        ax1.plot(horizons, avg_corr_by_h, marker="o", linewidth=2, markersize=8, color="#2ecc71")
        ax1.set_title("Corrélation moyenne par horizon", fontsize=12, fontweight="bold")
        ax1.set_xlabel("Horizon de prédiction")
        ax1.set_ylabel("Corrélation de Pearson")
        ax1.grid(True, alpha=0.3)
        ax1.set_ylim([0, 1])

        ax2.plot(horizons, avg_mae_by_h, marker="s", linewidth=2, markersize=8, color="#e74c3c")
        ax2.set_title("MAE moyenne par horizon", fontsize=12, fontweight="bold")
        ax2.set_xlabel("Horizon de prédiction")
        ax2.set_ylabel("MAE (dénormalisée)")
        ax2.grid(True, alpha=0.3)

        plt.tight_layout()
        plt.savefig("horizon_degradation.png", dpi=150)
        plt.close()
        mlflow.log_artifact("horizon_degradation.png")

        # 3. Scatter plots (t+30 min)
        fig, axes = plt.subplots(2, 3, figsize=(15, 10))
        axes = axes.flatten()
        for i, target_name in enumerate(TARGETS):
            ax = axes[i]
            yt = y_test_denorm[:, horizon_idx, i]
            yp = y_pred_denorm[:, horizon_idx, i]
            corr, _ = pearsonr(yt, yp)
            r2 = r2_score(yt, yp)

            ax.scatter(yt, yp, alpha=0.5, s=10, color="#3498db")
            lims = [min(yt.min(), yp.min()), max(yt.max(), yp.max())]
            ax.plot(lims, lims, "r--", alpha=0.5, linewidth=2, label="Prédiction parfaite")
            ax.set_xlabel(f"{target_name} Réel")
            ax.set_ylabel(f"{target_name} Prédit")
            ax.set_title(f"{target_name} – r={corr:.3f}, R²={r2:.3f}")
            ax.legend()
            ax.grid(True, alpha=0.3)
        axes[-1].axis("off")
        plt.tight_layout()
        plt.savefig("scatter_plots.png", dpi=150)
        plt.close()
        mlflow.log_artifact("scatter_plots.png")

        # 4. Distribution des erreurs
        fig, axes = plt.subplots(2, 3, figsize=(15, 10))
        axes = axes.flatten()
        for i, target_name in enumerate(TARGETS):
            ax = axes[i]
            yt = y_test_denorm[:, horizon_idx, i]
            yp = y_pred_denorm[:, horizon_idx, i]
            errors = yt - yp
            ax.hist(errors, bins=50, alpha=0.7, color="#9b59b6", edgecolor="black")
            ax.axvline(0, color="red", linestyle="--", linewidth=2, label="Erreur nulle")
            ax.set_xlabel("Erreur (Réel - Prédit)")
            ax.set_ylabel("Fréquence")
            ax.set_title(
                f"{target_name} – Distribution des erreurs\n"
                f"Moyenne: {errors.mean():.2f}, Std: {errors.std():.2f}"
            )
            ax.legend()
            ax.grid(True, alpha=0.3, axis="y")
        axes[-1].axis("off")
        plt.tight_layout()
        plt.savefig("error_distribution.png", dpi=150)
        plt.close()
        mlflow.log_artifact("error_distribution.png")

        # 5. Exemple de prédiction (superposition réel vs prédit)
        num_targets = len(TARGETS)
        fig, axes = plt.subplots(num_targets, 1, figsize=(18, 5 * num_targets), sharex=True)
        if num_targets == 1:
            axes = [axes]

        n_show = min(300, len(y_test_denorm))
        for i, target_name in enumerate(TARGETS):
            ax = axes[i]

            step_30 = min(5, HORIZON_STEPS - 1)
            yt_30 = y_test_denorm[:n_show, step_30, i]
            yp_30 = y_pred_denorm[:n_show, step_30, i]

            ax.plot(yt_30, label="Réel (t+30m)", color="#1f77b4", linewidth=1.2, alpha=0.8)
            ax.plot(yp_30, label="Prédit (t+30m)", color="#ff7f0e", linewidth=1.8)

            # Aussi afficher t+5 min pour comparaison
            if HORIZON_STEPS > 1:
                yp_5 = y_pred_denorm[:n_show, 0, i]
                ax.plot(
                    yp_5,
                    label="Prédit (t+5m)",
                    color="#2ecc71",
                    linewidth=1.2,
                    linestyle="--",
                    alpha=0.6,
                )

            ax.set_title(f"{target_name} – Prédiction à Horizon +30 min", fontsize=12)
            ax.legend()
            ax.grid(True, alpha=0.3)

        plt.xlabel("Échantillon")
        plt.tight_layout()
        plt.savefig("prediction_sample.png", dpi=150)
        plt.close()
        mlflow.log_artifact("prediction_sample.png")

        # ── Sauvegarde MLflow & Production ───────────────────
        from mlflow.models import infer_signature

        input_example = X_test[:5]
        prediction_example = model.predict(input_example)
        signature = infer_signature(input_example, prediction_example)

        mlflow.tensorflow.log_model(
            model=model,
            name="model",
            registered_model_name="IAQ_LSTM_Model",
            signature=signature,
            input_example=input_example,
        )
        mlflow.log_artifact("lstm_scaler.joblib")

        # --- Export Production ---
        project_root = Path(__file__).resolve().parent.parent.parent
        prod_path = project_root / "assets/ml_models"
        prod_path.mkdir(parents=True, exist_ok=True)

        model.save(prod_path / "lstm_model.keras")
        joblib.dump(scaler, prod_path / "lstm_scaler.joblib")

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
        logger.info(f"Run MLflow ID: {run.info.run_id}")

        # ── Notifier le backend de recharger le nouveau modèle ──
        _notify_backend_reload()


if __name__ == "__main__":
    default_csv = (
        Path(__file__).resolve().parent.parent.parent
        / "assets/datasets/ml_data/dataset_ml_5min.csv"
    )

    parser = argparse.ArgumentParser(
        description="Entraînement LSTM incrémental avec Optuna persistant"
    )
    parser.add_argument("--csv", default=str(default_csv), help="Chemin vers le CSV")
    parser.add_argument(
        "--trials", type=int, default=2,
        help="Nombre de nouveaux essais Optuna à ajouter (défaut: 2)",
    )
    parser.add_argument(
        "--epochs", type=int, default=30,
        help="Nombre d'epochs max pour le modèle final (défaut: 30)",
    )
    parser.add_argument(
        "--force-retrain", action="store_true",
        help="Forcer le réentraînement même sans amélioration",
    )
    parser.add_argument(
        "--show-study", action="store_true",
        help="Afficher un résumé de l'étude Optuna et quitter",
    )
    args = parser.parse_args()

    # Mode résumé : juste afficher l'état de l'étude Optuna
    if args.show_study:
        try:
            study = _load_or_create_study()
            n = len(study.trials)
            print(f"\n{'='*60}")
            print(f"Étude Optuna : {OPTUNA_STUDY_NAME}")
            print(f"DB : {OPTUNA_DB_PATH}")
            print(f"Trials cumulés : {n}")
            if n > 0:
                print(f"Meilleur val_loss : {study.best_value:.6f}")
                print(f"Meilleurs params : {study.best_params}")
                print(f"\nTop 5 trials :")
                df_trials = study.trials_dataframe().sort_values("value").head(5)
                print(
                    df_trials[["number", "value", "state"]].to_string(index=False)
                )
            else:
                print("Aucun trial encore effectué.")
            print(f"{'='*60}\n")
        except Exception as e:
            print(f"Erreur lecture étude: {e}")
    else:
        train_best_model(
            args.csv, args.trials, args.epochs, force_retrain=args.force_retrain
        )
