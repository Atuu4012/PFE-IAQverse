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
import csv
import json
import logging
import os
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

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
TARGET_HORIZON_IDX = min(5, HORIZON_STEPS - 1)
TARGET_HORIZON_MINUTES = (TARGET_HORIZON_IDX + 1) * 5

# Optuna persistant : fichier SQLite partagé entre exécutions
# En prod Docker, /app/assets/ml_models est un volume persistant → la DB survit aux redéploiements
# En local, on tombe dans assets/ml_models du projet
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_PERSISTENT_DIR = _PROJECT_ROOT / "assets" / "ml_models"
_PERSISTENT_DIR.mkdir(parents=True, exist_ok=True)
OPTUNA_DB_PATH = _PERSISTENT_DIR / "optuna_lstm_study.db"
OPTUNA_OBJECTIVE_METRIC = f"combined_score_t{TARGET_HORIZON_MINUTES}min"
OPTUNA_STUDY_NAME = os.getenv("OPTUNA_STUDY_NAME", "IAQ_LSTM_HPO_CORR_ALL_SENSORS_V1")
OPTUNA_DIRECTION = "maximize"
DEFAULT_SMOOTHING_WINDOW = max(1, int(os.getenv("LSTM_SMOOTHING_WINDOW", "3")))
DEFAULT_SMOOTHING_CANDIDATES = os.getenv("LSTM_SMOOTHING_CANDIDATES", "1,3,6")
DEFAULT_OBJECTIVE_CORR_WEIGHT = float(os.getenv("OPTUNA_CORR_WEIGHT", "0.7"))
DEFAULT_OBJECTIVE_MAE_WEIGHT = float(os.getenv("OPTUNA_MAE_WEIGHT", "0.3"))

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
DATASET_COLUMNS = [
    "timestamp",
    "co2",
    "pm25",
    "tvoc",
    "temperature",
    "humidity",
    "occupants",
    "enseigne",
    "salle",
    "capteur_id",
]

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


def _default_api_url() -> str:
    """Construit une URL backend valable """
    lookback_hours = os.getenv("API_LOOKBACK_HOURS", "72")

    if env_api_url := os.getenv("API_URL"):
        return env_api_url

    backend_host = "backend" if Path("/.dockerenv").exists() else "localhost"
    return f"http://{backend_host}:8000/api/iaq/data?hours={lookback_hours}"


def _recent_lookback_hours() -> int:
    """Fenêtre des nouvelles données à récupérer à chaque réentraînement."""
    raw_value = os.getenv("API_LOOKBACK_HOURS") or os.getenv("RETRAIN_INTERVAL") or "72"
    try:
        return max(1, int(float(raw_value)))
    except ValueError:
        logger.warning(f"API_LOOKBACK_HOURS invalide ({raw_value}), fallback à 72h")
        return 72


def _parse_positive_int_list(raw_value: str | None, default: list[int]) -> list[int]:
    """Parse une liste d'entiers positifs séparés par des virgules."""
    if not raw_value:
        return default

    values = []
    for chunk in raw_value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            parsed = int(chunk)
        except ValueError:
            logger.warning(f"Valeur de lissage ignorée (invalide): {chunk}")
            continue
        if parsed < 1:
            logger.warning(f"Valeur de lissage ignorée (<1): {parsed}")
            continue
        values.append(parsed)

    return sorted(set(values)) or default


def _normalize_objective_weights(corr_weight: float, mae_weight: float) -> tuple[float, float]:
    """Normalise les poids de l'objectif combiné pour éviter les dérives d'échelle."""
    corr_weight = max(0.0, float(corr_weight))
    mae_weight = max(0.0, float(mae_weight))
    total = corr_weight + mae_weight
    if total <= 0:
        return 0.5, 0.5
    return corr_weight / total, mae_weight / total


def _safe_correlation(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Corrélation de Pearson robuste aux séries constantes."""
    if len(y_true) <= 1:
        return float("nan")
    if np.std(y_true) <= 1e-12 or np.std(y_pred) <= 1e-12:
        return float("nan")
    corr, _ = pearsonr(y_true, y_pred)
    return float(corr)


def _safe_mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """MAPE robuste en ignorant les cibles nulles."""
    nonzero_mask = np.abs(y_true) > 1e-12
    if nonzero_mask.sum() == 0:
        return float("nan")
    return float(np.mean(np.abs((y_true[nonzero_mask] - y_pred[nonzero_mask]) / y_true[nonzero_mask])) * 100)


def _combined_objective_score(
    avg_correlation: float,
    avg_normalized_mae: float,
    corr_weight: float,
    mae_weight: float,
) -> float:
    """Score combiné à maximiser: corrélation haute et MAE normalisée basse."""
    if np.isnan(avg_correlation) or np.isnan(avg_normalized_mae):
        return float("nan")

    corr_weight, mae_weight = _normalize_objective_weights(corr_weight, mae_weight)
    return float((corr_weight * avg_correlation) - (mae_weight * avg_normalized_mae))


def _log_metric_if_finite(name: str, value: float) -> None:
    """Envoie une métrique à MLflow seulement si elle est exploitable."""
    if value is None:
        return
    value = float(value)
    if np.isfinite(value):
        mlflow.log_metric(name, value)


def _build_api_url(**override_params) -> str:
    """Construit l'URL de requête en fusionnant les paramètres fournis."""
    parsed = urlparse(_default_api_url())
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))

    for key, value in override_params.items():
        if value is None:
            query.pop(key, None)
        else:
            query[key] = str(value)

    return urlunparse(parsed._replace(query=urlencode(query)))


def _normalize_api_data(records: list[dict]) -> pd.DataFrame:
    """Met les données API au format du dataset ML 5 minutes."""
    if not records:
        return pd.DataFrame(columns=DATASET_COLUMNS)

    df = pd.DataFrame(records).copy()
    if df.empty:
        return pd.DataFrame(columns=DATASET_COLUMNS)

    if "sensor_id" in df.columns and "capteur_id" not in df.columns:
        df = df.rename(columns={"sensor_id": "capteur_id"})

    defaults = {
        "occupants": 0,
        "enseigne": "Maison",
        "salle": "Bureau",
        "capteur_id": "unknown",
    }
    for column, default in defaults.items():
        if column not in df.columns:
            df[column] = default
        else:
            df[column] = df[column].fillna(default)

    if "timestamp" not in df.columns:
        return pd.DataFrame(columns=DATASET_COLUMNS)

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True).dt.tz_localize(None)

    for column in ["co2", "pm25", "tvoc", "temperature", "humidity", "occupants"]:
        if column not in df.columns:
            df[column] = np.nan if column != "occupants" else 0
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df["occupants"] = df["occupants"].fillna(0).round().astype(int)
    df = df.dropna(subset=["timestamp", "capteur_id"])
    df = df.dropna(subset=TARGETS, how="all")
    df = df[DATASET_COLUMNS]
    df = df.sort_values(["timestamp", "capteur_id"]).reset_index(drop=True)
    return df


def _fetch_recent_api_data(hours: int) -> pd.DataFrame:
    """Récupère les dernières données agrégées à 5 minutes depuis l'API."""
    api_url = _build_api_url(hours=hours, step="5min", raw="false")
    logger.info(f"Récupération des données récentes via {api_url}")

    try:
        resp = requests.get(api_url, timeout=15)
        resp.raise_for_status()
        return _normalize_api_data(resp.json() or [])
    except Exception as e:
        logger.warning(f"Impossible de récupérer les données récentes: {e}")
        return pd.DataFrame(columns=DATASET_COLUMNS)


def _save_training_dataset(df: pd.DataFrame, csv_path: str) -> None:
    """Sauvegarde le dataset cumulatif dans le même format que le preprocessing."""
    output_path = Path(csv_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False, quoting=csv.QUOTE_ALL, float_format="%.6f")


def refresh_training_dataset(csv_path: str, lookback_hours: int) -> None:
    """Fusionne le dataset historique avec les nouvelles données Influx/API."""
    csv_file = Path(csv_path)
    if csv_file.exists():
        base_df = pd.read_csv(csv_file)
    else:
        logger.warning(f"Dataset absent, création à partir des données récentes: {csv_path}")
        base_df = pd.DataFrame(columns=DATASET_COLUMNS)

    if not base_df.empty:
        base_df.columns = base_df.columns.str.strip().str.replace('"', "")
        base_df["timestamp"] = pd.to_datetime(base_df["timestamp"], errors="coerce").dt.tz_localize(None)
        if "sensor_id" in base_df.columns and "capteur_id" not in base_df.columns:
            base_df = base_df.rename(columns={"sensor_id": "capteur_id"})
        for column in DATASET_COLUMNS:
            if column not in base_df.columns:
                base_df[column] = 0 if column == "occupants" else np.nan
        base_df = base_df[DATASET_COLUMNS]
        base_df["occupants"] = pd.to_numeric(base_df["occupants"], errors="coerce").fillna(0).round().astype(int)
        base_df = base_df.dropna(subset=["timestamp", "capteur_id"])

    recent_df = _fetch_recent_api_data(lookback_hours)
    if recent_df.empty:
        logger.info("Aucune nouvelle donnée API à fusionner dans le dataset cumulatif.")
        return

    previous_max_ts = base_df["timestamp"].max() if not base_df.empty else None
    if previous_max_ts is not None:
        recent_df = recent_df[recent_df["timestamp"] > previous_max_ts]

    if recent_df.empty:
        logger.info("Pas de données plus récentes que le dataset courant.")
        return

    before_rows = len(base_df)
    merged_df = pd.concat([base_df, recent_df], ignore_index=True)
    merged_df = merged_df.drop_duplicates(subset=["timestamp", "capteur_id"], keep="last")
    merged_df = merged_df.sort_values(["timestamp", "capteur_id"]).reset_index(drop=True)
    _save_training_dataset(merged_df, csv_path)

    logger.info(
        f"Dataset cumulatif mis à jour: +{len(recent_df)} nouvelles lignes, "
        f"{before_rows} → {len(merged_df)} lignes"
    )


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
def _apply_group_smoothing(df: pd.DataFrame, smoothing_window: int) -> pd.DataFrame:
    """Applique un lissage par capteur, ou le désactive si la fenêtre vaut 1."""
    smoothed_df = df.copy()
    smoothing_window = max(1, int(smoothing_window))

    if smoothing_window <= 1:
        logger.info("Lissage désactivé pour cette variante (window=1)")
        return smoothed_df

    cols_to_smooth = ["co2", "pm25", "tvoc", "temperature", "humidity"]
    logger.info(f"Application du lissage par capteur (window={smoothing_window})")
    for col in cols_to_smooth:
        if col in smoothed_df.columns:
            smoothed_df[col] = smoothed_df.groupby("sensor_id")[col].transform(
                lambda s: s.rolling(window=smoothing_window, min_periods=1).mean()
            )
    return smoothed_df


def load_data(
    csv_path: str,
    fetch_recent_api: bool = True,
    smoothing_window: int = DEFAULT_SMOOTHING_WINDOW,
) -> pd.DataFrame | None:
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
    if fetch_recent_api:
        df_new = _fetch_recent_api_data(_recent_lookback_hours())
        if not df_new.empty:
            df = pd.concat([df, df_new], ignore_index=True)
            logger.info(f"Ajouté {len(df_new)} points récents depuis l'API")

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

    df = _apply_group_smoothing(df, smoothing_window)

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


def build_train_test_sequences_per_sensor(
    df: pd.DataFrame,
    scaler: MinMaxScaler,
    n_in: int,
    n_out: int,
    train_ratio: float = 0.8,
):
    """Crée les séquences pour tous les capteurs avec split temporel par capteur.

    On évite ainsi de ne retenir qu'un seul capteur et on conserve un découpage
    train/test chronologique indépendant pour chaque série temporelle.
    """
    train_X_parts, train_y_parts = [], []
    test_X_parts, test_y_parts = [], []
    total_sequences = 0

    for sensor_id, grp in df.groupby("sensor_id"):
        arr = grp[FEATURES].values
        scaled = scaler.transform(arr)
        Xs, ys = create_sequences(scaled, n_in, n_out)
        if len(Xs) == 0:
            continue

        split_idx = max(1, int(len(Xs) * train_ratio))
        if split_idx >= len(Xs):
            split_idx = len(Xs) - 1
        if split_idx <= 0:
            continue

        logger.info(
            f"  Capteur {sensor_id}: {len(Xs)} séquences "
            f"(train={split_idx}, test={len(Xs) - split_idx})"
        )

        train_X_parts.append(Xs[:split_idx])
        train_y_parts.append(ys[:split_idx])
        test_X_parts.append(Xs[split_idx:])
        test_y_parts.append(ys[split_idx:])
        total_sequences += len(Xs)

    if not train_X_parts or not test_X_parts:
        raise RuntimeError("Pas assez de séquences multi-capteurs pour construire train/test.")

    X_train = np.concatenate(train_X_parts, axis=0)
    y_train = np.concatenate(train_y_parts, axis=0)
    X_test = np.concatenate(test_X_parts, axis=0)
    y_test = np.concatenate(test_y_parts, axis=0)

    logger.info(
        f"  → Multi-capteurs retenus: {len(train_X_parts)} capteurs, "
        f"{total_sequences} séquences totales"
    )
    return X_train, X_test, y_train, y_test


def prepare_train_test_data(
    df_base: pd.DataFrame,
    smoothing_window: int,
    n_in: int,
    n_out: int,
    train_ratio: float = 0.8,
) -> dict[str, np.ndarray | MinMaxScaler | int]:
    """Prépare une variante complète train/test pour une fenêtre de lissage donnée."""
    df_variant = _apply_group_smoothing(df_base, smoothing_window)

    train_frames = []
    for _, grp in df_variant.groupby("sensor_id"):
        n_train = max(1, int(len(grp) * train_ratio))
        train_frames.append(grp.iloc[:n_train])

    if not train_frames:
        raise RuntimeError("Impossible de préparer le scaler: aucun capteur exploitable.")

    train_df = pd.concat(train_frames)
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaler.fit(train_df[FEATURES].values)

    X_train, X_test, y_train, y_test = build_train_test_sequences_per_sensor(
        df_variant,
        scaler,
        n_in,
        n_out,
        train_ratio=train_ratio,
    )

    if np.isnan(X_train).any() or np.isnan(y_train).any():
        logger.warning("NaNs détectés dans train, nettoyage…")
        valid_train = ~np.isnan(X_train).any(axis=(1, 2)) & ~np.isnan(y_train).any(axis=(1, 2))
        X_train, y_train = X_train[valid_train], y_train[valid_train]
    if np.isnan(X_test).any() or np.isnan(y_test).any():
        logger.warning("NaNs détectés dans test, nettoyage…")
        valid_test = ~np.isnan(X_test).any(axis=(1, 2)) & ~np.isnan(y_test).any(axis=(1, 2))
        X_test, y_test = X_test[valid_test], y_test[valid_test]

    X_trial = X_train[::2]
    y_trial = y_train[::2]

    logger.info(
        f"Variante window={smoothing_window}: train={X_train.shape}, test={X_test.shape}, "
        f"optuna={X_trial.shape}"
    )

    return {
        "smoothing_window": smoothing_window,
        "scaler": scaler,
        "X_train": X_train,
        "X_test": X_test,
        "y_train": y_train,
        "y_test": y_test,
        "X_trial": X_trial,
        "y_trial": y_trial,
    }


def _denormalize_targets(
    y_true: np.ndarray, y_pred: np.ndarray, scaler: MinMaxScaler
) -> tuple[np.ndarray, np.ndarray]:
    """Ramène les targets dans leurs unités d'origine pour calculer des métriques lisibles."""
    y_true_denorm = np.zeros_like(y_true)
    y_pred_denorm = np.zeros_like(y_pred)

    for index, target_name in enumerate(TARGETS):
        try:
            feat_idx = FEATURES.index(target_name)
            data_min = scaler.data_min_[feat_idx]
            data_range = scaler.data_range_[feat_idx]
            y_true_denorm[:, :, index] = y_true[:, :, index] * data_range + data_min
            y_pred_denorm[:, :, index] = y_pred[:, :, index] * data_range + data_min
        except ValueError:
            y_true_denorm[:, :, index] = y_true[:, :, index]
            y_pred_denorm[:, :, index] = y_pred[:, :, index]

    return y_true_denorm, y_pred_denorm


def _compute_horizon_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    scaler: MinMaxScaler,
    horizon_idx: int,
) -> dict[str, float]:
    """Calcule des métriques agrégées au pas d'horizon demandé."""
    y_true_denorm, y_pred_denorm = _denormalize_targets(y_true, y_pred, scaler)

    correlations = []
    maes = []
    normalized_maes = []
    for target_index in range(len(TARGETS)):
        y_true_h = y_true_denorm[:, horizon_idx, target_index]
        y_pred_h = y_pred_denorm[:, horizon_idx, target_index]

        mae = mean_absolute_error(y_true_h, y_pred_h)
        maes.append(mae)

        target_scale = max(float(np.std(y_true_h)), 1e-6)
        normalized_maes.append(mae / target_scale)

        corr = _safe_correlation(y_true_h, y_pred_h)
        if not np.isnan(corr):
            correlations.append(corr)

    return {
        "avg_mae": float(np.mean(maes)) if maes else float("nan"),
        "avg_normalized_mae": float(np.mean(normalized_maes)) if normalized_maes else float("nan"),
        "avg_correlation": float(np.mean(correlations)) if correlations else float("nan"),
    }


def _compute_metrics_by_horizon(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    scaler: MinMaxScaler,
    corr_weight: float,
    mae_weight: float,
) -> pd.DataFrame:
    """Construit un tableau complet des métriques par horizon et par cible."""
    y_true_denorm, y_pred_denorm = _denormalize_targets(y_true, y_pred, scaler)
    rows = []

    for horizon_idx in range(y_true.shape[1]):
        row = {
            "horizon_step": horizon_idx + 1,
            "horizon_minutes": (horizon_idx + 1) * 5,
            "horizon_label": f"t+{(horizon_idx + 1) * 5}min",
        }
        correlations = []
        maes = []
        normalized_maes = []

        for target_index, target_name in enumerate(TARGETS):
            y_true_h = y_true_denorm[:, horizon_idx, target_index]
            y_pred_h = y_pred_denorm[:, horizon_idx, target_index]

            mae = mean_absolute_error(y_true_h, y_pred_h)
            rmse = float(np.sqrt(mean_squared_error(y_true_h, y_pred_h)))
            corr = _safe_correlation(y_true_h, y_pred_h)
            r2 = float(r2_score(y_true_h, y_pred_h)) if len(y_true_h) > 1 else float("nan")
            mape = _safe_mape(y_true_h, y_pred_h)
            normalized_mae = mae / max(float(np.std(y_true_h)), 1e-6)

            row[f"{target_name}_mae"] = float(mae)
            row[f"{target_name}_rmse"] = rmse
            row[f"{target_name}_correlation"] = corr
            row[f"{target_name}_r2"] = r2
            row[f"{target_name}_mape"] = mape
            row[f"{target_name}_normalized_mae"] = float(normalized_mae)

            maes.append(mae)
            normalized_maes.append(normalized_mae)
            if not np.isnan(corr):
                correlations.append(corr)

        row["avg_mae"] = float(np.mean(maes)) if maes else float("nan")
        row["avg_normalized_mae"] = (
            float(np.mean(normalized_maes)) if normalized_maes else float("nan")
        )
        row["avg_correlation"] = float(np.mean(correlations)) if correlations else float("nan")
        row["combined_score"] = _combined_objective_score(
            row["avg_correlation"],
            row["avg_normalized_mae"],
            corr_weight,
            mae_weight,
        )
        rows.append(row)

    return pd.DataFrame(rows)


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
        direction=OPTUNA_DIRECTION,
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
    smoothing_candidates: list[int] | None = None,
    objective_corr_weight: float = DEFAULT_OBJECTIVE_CORR_WEIGHT,
    objective_mae_weight: float = DEFAULT_OBJECTIVE_MAE_WEIGHT,
):
    """Pipeline incrémental : data → Optuna (+N trials) → meilleur modèle → MLflow.

    Grâce au stockage SQLite, chaque exécution quotidienne ajoute `n_trials`
    essais à l'étude Optuna existante. Le modèle n'est réentraîné que si :
      - force_retrain est True, OU
      - le nombre total de trials atteint MIN_TRIALS_FOR_BEST, OU
      - de meilleurs hyperparamètres ont été trouvés lors de cette session.
    """

    # ── 1. Préparation des données ───────────────────────────
    lookback_hours = _recent_lookback_hours()
    if os.getenv("DISABLE_INCREMENTAL_API") != "1":
        refresh_training_dataset(csv_path, lookback_hours)
    else:
        logger.info("Synchronisation incrémentale API désactivée pour cet entraînement.")

    df_base = load_data(csv_path, fetch_recent_api=False, smoothing_window=1)
    if df_base is None:
        return

    if len(df_base) < 500:
        logger.error(f"Pas assez de données pour entraîner ({len(df_base)} lignes)")
        return

    smoothing_candidates = smoothing_candidates or _parse_positive_int_list(
        DEFAULT_SMOOTHING_CANDIDATES,
        [DEFAULT_SMOOTHING_WINDOW],
    )
    corr_weight, mae_weight = _normalize_objective_weights(
        objective_corr_weight,
        objective_mae_weight,
    )
    logger.info(
        f"Objectif combiné: corr_weight={corr_weight:.2f}, mae_weight={mae_weight:.2f}, "
        f"horizon cible=t+{TARGET_HORIZON_MINUTES}min"
    )
    logger.info(f"Fenêtres de lissage testées: {smoothing_candidates}")

    dataset_cache: dict[int, dict[str, np.ndarray | MinMaxScaler | int]] = {}

    def get_dataset_variant(smoothing_window: int):
        smoothing_window = int(smoothing_window)
        if smoothing_window not in dataset_cache:
            dataset_cache[smoothing_window] = prepare_train_test_data(
                df_base=df_base,
                smoothing_window=smoothing_window,
                n_in=LOOKBACK_STEPS,
                n_out=HORIZON_STEPS,
            )
        return dataset_cache[smoothing_window]

    baseline_variant = get_dataset_variant(smoothing_candidates[0])
    logger.info(
        f"Variante initiale chargée: window={smoothing_candidates[0]}, "
        f"train={baseline_variant['X_train'].shape}, test={baseline_variant['X_test'].shape}"
    )

    # ── 2. Optuna incrémental (persistant SQLite) ────────────
    # Charger l'étude existante
    study = _load_or_create_study()
    prev_best = study.best_value if len(study.trials) > 0 else float("-inf")
    prev_n_trials = len(study.trials)
    logger.info(
        f"Étude Optuna '{OPTUNA_STUDY_NAME}': {prev_n_trials} trials existants, "
        f"meilleur {OPTUNA_OBJECTIVE_METRIC} = {prev_best:.6f}"
    )

    def objective(trial):
        # Hyperparamètres à explorer
        lstm_units = trial.suggest_int("lstm_units", 64, 280, step=32)
        n_layers = trial.suggest_int("n_layers", 1, 5)
        dropout_rate = trial.suggest_float("dropout_rate", 0.0, 0.15)
        learning_rate = trial.suggest_float("learning_rate", 1e-4, 5e-3, log=True)
        use_attention = trial.suggest_categorical("use_attention", [True, False])
        if len(smoothing_candidates) > 1:
            smoothing_window = trial.suggest_categorical("smoothing_window", smoothing_candidates)
        else:
            smoothing_window = smoothing_candidates[0]

        dataset_variant = get_dataset_variant(smoothing_window)
        X_trial = dataset_variant["X_trial"]
        y_trial = dataset_variant["y_trial"]
        X_test = dataset_variant["X_test"]
        y_test = dataset_variant["y_test"]
        scaler = dataset_variant["scaler"]

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
            train_loss = history.history["loss"][-1]
            y_pred_trial = model.predict(X_test, verbose=0)
            horizon_metrics = _compute_horizon_metrics(
                y_true=y_test,
                y_pred=y_pred_trial,
                scaler=scaler,
                horizon_idx=min(5, HORIZON_STEPS - 1),
            )

            trial.set_user_attr("train_loss", float(train_loss))
            trial.set_user_attr("val_loss", float(val_loss))
            if not np.isnan(horizon_metrics["avg_correlation"]):
                trial.set_user_attr(
                    "avg_correlation_t30min", float(horizon_metrics["avg_correlation"])
                )
            if not np.isnan(horizon_metrics["avg_mae"]):
                trial.set_user_attr("avg_mae_t30min", float(horizon_metrics["avg_mae"]))
            if not np.isnan(horizon_metrics["avg_normalized_mae"]):
                trial.set_user_attr(
                    "avg_normalized_mae_t30min",
                    float(horizon_metrics["avg_normalized_mae"]),
                )

            corr30 = horizon_metrics["avg_correlation"]
            mae30_norm = horizon_metrics["avg_normalized_mae"]
            score = _combined_objective_score(corr30, mae30_norm, corr_weight, mae_weight)
            if np.isnan(score):
                score = float("-inf")
            trial.set_user_attr(f"combined_score_t{TARGET_HORIZON_MINUTES}min", float(score))
            trial.set_user_attr("smoothing_window", int(smoothing_window))
            logger.info(
                f"  Trial {trial.number} → score={score:.6f} "
                f"(corr30={corr30:.4f}, nmae30={mae30_norm:.4f}, val_loss={val_loss:.6f}, "
                f"smooth={smoothing_window}, units={lstm_units}, layers={n_layers}, "
                f"lr={learning_rate:.5f}, attn={use_attention})"
            )
            return score

        except Exception as e:
            logger.warning(f"Trial {trial.number} failed: {e}")
            return float("-inf")

    # Lancer les nouveaux trials (s'ajoutent aux précédents dans la DB)
    if n_trials > 0:
        logger.info(f"Lancement de {n_trials} nouveaux trials Optuna…")
        study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    total_trials = len(study.trials)
    new_best = study.best_value if total_trials > 0 else float("-inf")
    best_params = study.best_params if total_trials > 0 else None

    logger.info(f"Total trials cumulés: {total_trials}")
    logger.info(f"Meilleur {OPTUNA_OBJECTIVE_METRIC} global: {new_best:.6f}")
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
        improved = new_best > prev_best
        first_threshold = prev_n_trials < MIN_TRIALS_FOR_BEST <= total_trials
        should_retrain = improved or first_threshold

        if improved:
            logger.info(
                f"Amélioration détectée sur {OPTUNA_OBJECTIVE_METRIC}! "
                f"{prev_best:.6f} → {new_best:.6f} "
                f"(Δ = {new_best - prev_best:.6f})"
            )
        elif first_threshold:
            logger.info(
                f"Seuil de {MIN_TRIALS_FOR_BEST} trials atteint, "
                f"premier entraînement complet."
            )
        else:
            logger.info(
                f"Pas d'amélioration sur {OPTUNA_OBJECTIVE_METRIC} (best={new_best:.6f}). "
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
        mlflow.log_param("objective_metric", OPTUNA_OBJECTIVE_METRIC)
        mlflow.log_param("objective_corr_weight", corr_weight)
        mlflow.log_param("objective_mae_weight", mae_weight)

        best_smoothing_window = int(best_params.get("smoothing_window", smoothing_candidates[0]))
        best_variant = get_dataset_variant(best_smoothing_window)
        scaler = best_variant["scaler"]
        X_train = best_variant["X_train"]
        X_test = best_variant["X_test"]
        y_train = best_variant["y_train"]
        y_test = best_variant["y_test"]
        mlflow.log_param("smoothing_window", best_smoothing_window)
        _log_metric_if_finite(OPTUNA_OBJECTIVE_METRIC, new_best)
        joblib.dump(scaler, "lstm_scaler.joblib")

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

        y_pred_full = model.predict(X_test, verbose=0)
        y_test_denorm, y_pred_denorm = _denormalize_targets(y_test, y_pred_full, scaler)
        horizon_metrics_df = _compute_metrics_by_horizon(
            y_true=y_test,
            y_pred=y_pred_full,
            scaler=scaler,
            corr_weight=corr_weight,
            mae_weight=mae_weight,
        )

        # --- Métriques détaillées à l'horizon cible (déployé en production) ---
        horizon_idx = TARGET_HORIZON_IDX
        for i, target_name in enumerate(TARGETS):
            y_true = y_test_denorm[:, horizon_idx, i]
            y_pred = y_pred_denorm[:, horizon_idx, i]

            mae = mean_absolute_error(y_true, y_pred)
            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            r2 = r2_score(y_true, y_pred)
            corr = _safe_correlation(y_true, y_pred)
            mape = _safe_mape(y_true, y_pred)

            if len(y_true) > 1:
                true_dir = np.diff(y_true) > 0
                pred_dir = np.diff(y_pred) > 0
                dir_acc = np.mean(true_dir == pred_dir) * 100
            else:
                dir_acc = 0

            mlflow.log_metric(f"{target_name}_mae_t30min", mae)
            mlflow.log_metric(f"{target_name}_rmse_t30min", rmse)
            mlflow.log_metric(f"{target_name}_r2_t30min", r2)
            _log_metric_if_finite(f"{target_name}_correlation_t30min", corr)
            _log_metric_if_finite(f"{target_name}_mape_t30min", mape)
            mlflow.log_metric(f"{target_name}_directional_accuracy", dir_acc)

        # --- Métriques par horizon ---
        for _, row in horizon_metrics_df.iterrows():
            horizon_minutes = int(row["horizon_minutes"])
            _log_metric_if_finite(f"avg_correlation_t{horizon_minutes}min", row["avg_correlation"])
            _log_metric_if_finite(f"avg_mae_t{horizon_minutes}min", row["avg_mae"])
            _log_metric_if_finite(
                f"avg_normalized_mae_t{horizon_minutes}min",
                row["avg_normalized_mae"],
            )
            _log_metric_if_finite(f"combined_score_t{horizon_minutes}min", row["combined_score"])
            for target_name in TARGETS:
                _log_metric_if_finite(
                    f"{target_name}_correlation_t{horizon_minutes}min",
                    row[f"{target_name}_correlation"],
                )
                _log_metric_if_finite(
                    f"{target_name}_mae_t{horizon_minutes}min",
                    row[f"{target_name}_mae"],
                )
                _log_metric_if_finite(
                    f"{target_name}_rmse_t{horizon_minutes}min",
                    row[f"{target_name}_rmse"],
                )
                _log_metric_if_finite(
                    f"{target_name}_r2_t{horizon_minutes}min",
                    row[f"{target_name}_r2"],
                )
                _log_metric_if_finite(
                    f"{target_name}_mape_t{horizon_minutes}min",
                    row[f"{target_name}_mape"],
                )

        horizon_metrics_df.to_csv("horizon_metrics.csv", index=False)
        with open("horizon_metrics.json", "w", encoding="utf-8") as horizon_fp:
            json.dump(horizon_metrics_df.to_dict(orient="records"), horizon_fp, indent=2)
        mlflow.log_artifact("horizon_metrics.csv")
        mlflow.log_artifact("horizon_metrics.json")

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
        horizons = horizon_metrics_df["horizon_label"].tolist()
        avg_corr_by_h = horizon_metrics_df["avg_correlation"].tolist()
        avg_mae_by_h = horizon_metrics_df["avg_mae"].tolist()
        combined_by_h = horizon_metrics_df["combined_score"].tolist()

        fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(20, 5))
        ax1.plot(horizons, avg_corr_by_h, marker="o", linewidth=2, markersize=8, color="#2ecc71")
        ax1.set_title("Corrélation moyenne par horizon", fontsize=12, fontweight="bold")
        ax1.set_xlabel("Horizon de prédiction")
        ax1.set_ylabel("Corrélation de Pearson")
        ax1.grid(True, alpha=0.3)
        ax1.set_ylim([-1, 1])

        ax2.plot(horizons, avg_mae_by_h, marker="s", linewidth=2, markersize=8, color="#e74c3c")
        ax2.set_title("MAE moyenne par horizon", fontsize=12, fontweight="bold")
        ax2.set_xlabel("Horizon de prédiction")
        ax2.set_ylabel("MAE (dénormalisée)")
        ax2.grid(True, alpha=0.3)

        ax3.plot(horizons, combined_by_h, marker="^", linewidth=2, markersize=8, color="#1f77b4")
        ax3.set_title("Score combiné par horizon", fontsize=12, fontweight="bold")
        ax3.set_xlabel("Horizon de prédiction")
        ax3.set_ylabel("Corrélation pondérée - NMAE pondérée")
        ax3.grid(True, alpha=0.3)

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
            corr = _safe_correlation(yt, yp)
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

        with tempfile.TemporaryDirectory(prefix="mlflow_lstm_model_") as tmp_dir:
            model_artifact_dir = Path(tmp_dir) / "model"
            mlflow.tensorflow.save_model(
                model=model,
                path=str(model_artifact_dir),
                signature=signature,
                input_example=input_example,
                metadata={
                    "objective_metric": OPTUNA_OBJECTIVE_METRIC,
                    "target_horizon_minutes": TARGET_HORIZON_MINUTES,
                    "smoothing_window": best_smoothing_window,
                },
            )
            mlflow.log_artifacts(str(model_artifact_dir), artifact_path="model")

        try:
            model_uri = f"runs:/{run.info.run_id}/model"
            registration = mlflow.register_model(model_uri=model_uri, name="IAQ_LSTM_Model")
            logger.info(
                f"Modèle MLflow enregistré: IAQ_LSTM_Model v{registration.version}"
            )
        except Exception as e:
            logger.warning(f"Enregistrement du modèle MLflow impossible: {e}")

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
            "target_horizon_minutes": TARGET_HORIZON_MINUTES,
            "smoothing_window": best_smoothing_window,
            "objective_metric": OPTUNA_OBJECTIVE_METRIC,
            "objective_corr_weight": corr_weight,
            "objective_mae_weight": mae_weight,
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
    parser.add_argument(
        "--smoothing-window",
        type=int,
        default=DEFAULT_SMOOTHING_WINDOW,
        help="Fenêtre de lissage par défaut si aucune recherche n'est faite (défaut: 3)",
    )
    parser.add_argument(
        "--smoothing-candidates",
        default=DEFAULT_SMOOTHING_CANDIDATES,
        help="Fenêtres de lissage à tester par Optuna, séparées par des virgules (ex: 1,3,6)",
    )
    parser.add_argument(
        "--objective-corr-weight",
        type=float,
        default=DEFAULT_OBJECTIVE_CORR_WEIGHT,
        help="Poids de la corrélation dans le score combiné Optuna",
    )
    parser.add_argument(
        "--objective-mae-weight",
        type=float,
        default=DEFAULT_OBJECTIVE_MAE_WEIGHT,
        help="Poids de la MAE normalisée dans le score combiné Optuna",
    )
    args = parser.parse_args()

    smoothing_candidates = _parse_positive_int_list(
        args.smoothing_candidates,
        [max(1, args.smoothing_window)],
    )
    if max(1, args.smoothing_window) not in smoothing_candidates:
        smoothing_candidates.append(max(1, args.smoothing_window))
        smoothing_candidates = sorted(set(smoothing_candidates))

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
                print(f"Meilleur {OPTUNA_OBJECTIVE_METRIC} : {study.best_value:.6f}")
                print(f"Meilleurs params : {study.best_params}")
                print(f"\nTop 5 trials :")
                df_trials = study.trials_dataframe().sort_values("value", ascending=False).head(5)
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
            args.csv,
            args.trials,
            args.epochs,
            force_retrain=args.force_retrain,
            smoothing_candidates=smoothing_candidates,
            objective_corr_weight=args.objective_corr_weight,
            objective_mae_weight=args.objective_mae_weight,
        )
