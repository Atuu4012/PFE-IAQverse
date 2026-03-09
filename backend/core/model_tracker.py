"""
Model Performance Tracker — Auto-évaluation des prédictions LSTM.

Principe :
1. Après chaque prédiction, on enregistre (predicted_at, target_at, valeurs prédites).
2. Une tâche de fond évalue périodiquement les prédictions dont target_at est passé :
   elle récupère les valeurs réelles et calcule les erreurs.
3. Des endpoints API exposent les métriques agrégées pour le frontend.

Stockage : SQLite léger dans assets/ml_models/model_tracker.db
"""

import sqlite3
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

_DB_DIR = Path(__file__).resolve().parent.parent.parent / "assets" / "ml_models"
_DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = _DB_DIR / "model_tracker.db"

# Verrou pour l'accès concurrent (asyncio + threads)
_lock = threading.Lock()

# Métriques cibles
TRACKED_TARGETS = ["co2", "pm25", "tvoc", "temperature", "humidity"]


# ── Initialisation de la base ────────────────────────────────────
def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # améliore la concurrence
    return conn


def init_db():
    """Crée les tables si elles n'existent pas."""
    with _lock:
        conn = _get_conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS predictions (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    predicted_at TEXT NOT NULL,
                    target_at    TEXT NOT NULL,
                    enseigne     TEXT,
                    salle        TEXT,
                    sensor_id    TEXT,
                    model_type   TEXT DEFAULT 'lstm',
                    -- Valeurs prédites
                    pred_co2         REAL,
                    pred_pm25        REAL,
                    pred_tvoc        REAL,
                    pred_temperature REAL,
                    pred_humidity    REAL,
                    -- Valeurs réelles (remplies par l'évaluateur)
                    actual_co2         REAL,
                    actual_pm25        REAL,
                    actual_tvoc        REAL,
                    actual_temperature REAL,
                    actual_humidity    REAL,
                    -- État de l'évaluation
                    evaluated   INTEGER DEFAULT 0,
                    evaluated_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_pred_target
                    ON predictions(target_at, evaluated);
                CREATE INDEX IF NOT EXISTS idx_pred_sensor
                    ON predictions(enseigne, salle, sensor_id);
            """)
            conn.commit()
            logger.info(f"✅ Model tracker DB initialisée : {DB_PATH}")
        finally:
            conn.close()


# ── Enregistrement d'une prédiction ────────────────────────────
def log_prediction(
    predicted_at: str,
    target_at: str,
    enseigne: str,
    salle: str,
    sensor_id: str,
    predicted_values: Dict[str, float],
    model_type: str = "lstm",
):
    """Enregistre une prédiction pour évaluation ultérieure.
    
    Déduplique : ignore si une prédiction pour le même (enseigne, salle, sensor_id)
    existe déjà dans les 30 dernières secondes (évite les doublons quand
    /api/predict/score et /api/predict/preventive-actions appellent predict()
    dans le même cycle).
    """
    with _lock:
        conn = _get_conn()
        try:
            # Anti-doublon : vérifier si une prédiction récente existe déjà
            recent = conn.execute(
                """SELECT COUNT(*) FROM predictions
                   WHERE enseigne = ? AND salle = ? AND sensor_id = ?
                   AND predicted_at > ?""",
                (
                    enseigne, salle, sensor_id,
                    (datetime.fromisoformat(predicted_at) - timedelta(seconds=30)).isoformat(),
                ),
            ).fetchone()[0]
            if recent > 0:
                return  # doublon, on skip

            conn.execute(
                """INSERT INTO predictions
                   (predicted_at, target_at, enseigne, salle, sensor_id, model_type,
                    pred_co2, pred_pm25, pred_tvoc, pred_temperature, pred_humidity)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    predicted_at,
                    target_at,
                    enseigne,
                    salle,
                    sensor_id,
                    model_type,
                    predicted_values.get("co2"),
                    predicted_values.get("pm25"),
                    predicted_values.get("tvoc"),
                    predicted_values.get("temperature"),
                    predicted_values.get("humidity"),
                ),
            )
            conn.commit()
        finally:
            conn.close()


# ── Évaluation des prédictions passées ─────────────────────────
def evaluate_pending(fetch_actual_fn) -> int:
    """
    Évalue toutes les prédictions dont target_at est dépassé.

    Args:
        fetch_actual_fn: callable(enseigne, salle, sensor_id, target_dt) -> dict | None
            Doit renvoyer {"co2": ..., "pm25": ..., ...} ou None si indisponible.

    Returns:
        Nombre de prédictions évaluées lors de cet appel.
    """
    now = datetime.utcnow().isoformat()
    evaluated_count = 0

    with _lock:
        conn = _get_conn()
        try:
            rows = conn.execute(
                """SELECT id, target_at, enseigne, salle, sensor_id
                   FROM predictions
                   WHERE evaluated = 0 AND target_at <= ?
                   ORDER BY target_at
                   LIMIT 200""",
                (now,),
            ).fetchall()

            for row in rows:
                actual = fetch_actual_fn(
                    row["enseigne"],
                    row["salle"],
                    row["sensor_id"],
                    row["target_at"],
                )
                if actual is None:
                    continue

                conn.execute(
                    """UPDATE predictions
                       SET actual_co2 = ?, actual_pm25 = ?, actual_tvoc = ?,
                           actual_temperature = ?, actual_humidity = ?,
                           evaluated = 1, evaluated_at = ?
                       WHERE id = ?""",
                    (
                        actual.get("co2"),
                        actual.get("pm25"),
                        actual.get("tvoc"),
                        actual.get("temperature"),
                        actual.get("humidity"),
                        datetime.utcnow().isoformat(),
                        row["id"],
                    ),
                )
                evaluated_count += 1

            conn.commit()
        finally:
            conn.close()

    if evaluated_count:
        logger.info(f"{evaluated_count} prédictions évaluées")
    return evaluated_count


# ── Calcul des métriques agrégées ──────────────────────────────
def get_performance(hours: Optional[int] = None) -> Dict:
    """
    Renvoie les métriques de performance du modèle.

    Args:
        hours: Fenêtre temporelle (ex: 24 = dernières 24h). None = tout.

    Returns:
        {
            "total_predictions": int,
            "evaluated": int,
            "pending": int,
            "metrics": {
                "co2":  {"mae": ..., "correlation": ..., "mape": ..., "accuracy_5pct": ...},
                "pm25": {...},
                ...
            },
            "recent_errors": [...],  # les 20 dernières évaluations
            "period_hours": int | null
        }
    """
    with _lock:
        conn = _get_conn()
        try:
            # Filtre temporel
            if hours:
                cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
                where = "WHERE predicted_at >= ?"
                params: tuple = (cutoff,)
            else:
                where = ""
                params = ()

            # Compteurs
            total = conn.execute(
                f"SELECT COUNT(*) FROM predictions {where}", params
            ).fetchone()[0]
            evaluated = conn.execute(
                f"SELECT COUNT(*) FROM predictions {where} {'AND' if where else 'WHERE'} evaluated = 1",
                params,
            ).fetchone()[0]

            # Récupérer les prédictions évaluées
            eval_where = f"{where} {'AND' if where else 'WHERE'} evaluated = 1"
            rows = conn.execute(
                f"""SELECT pred_co2, pred_pm25, pred_tvoc, pred_temperature, pred_humidity,
                           actual_co2, actual_pm25, actual_tvoc, actual_temperature, actual_humidity,
                           predicted_at, target_at, enseigne, salle, sensor_id
                    FROM predictions {eval_where}
                    ORDER BY target_at DESC""",
                params,
            ).fetchall()

            # Calcul des métriques par cible
            metrics = {}
            for target in TRACKED_TARGETS:
                preds = []
                actuals = []
                for r in rows:
                    p = r[f"pred_{target}"]
                    a = r[f"actual_{target}"]
                    if p is not None and a is not None:
                        preds.append(p)
                        actuals.append(a)

                if len(preds) < 2:
                    metrics[target] = {
                        "mae": None,
                        "correlation": None,
                        "mape": None,
                        "accuracy_5pct": None,
                        "n_samples": len(preds),
                    }
                    continue

                preds_arr = np.array(preds)
                actuals_arr = np.array(actuals)
                errors = preds_arr - actuals_arr
                abs_errors = np.abs(errors)

                mae = float(np.mean(abs_errors))
                if np.std(preds_arr) > 1e-12 and np.std(actuals_arr) > 1e-12:
                    correlation = float(np.corrcoef(preds_arr, actuals_arr)[0, 1])
                else:
                    correlation = None

                # MAPE (éviter division par zéro)
                nonzero_mask = actuals_arr != 0
                if nonzero_mask.sum() > 0:
                    mape = float(
                        np.mean(np.abs(errors[nonzero_mask] / actuals_arr[nonzero_mask])) * 100
                    )
                else:
                    mape = None

                # Précision simplifiée : % de fois où |erreur| < 5% de la valeur réelle
                if nonzero_mask.sum() > 0:
                    within_5pct = np.abs(errors[nonzero_mask]) < 0.05 * np.abs(
                        actuals_arr[nonzero_mask]
                    )
                    accuracy_5pct = float(np.mean(within_5pct) * 100)
                else:
                    accuracy_5pct = None

                metrics[target] = {
                    "mae": round(mae, 2),
                    "correlation": round(correlation, 3) if correlation is not None else None,
                    "mape": round(mape, 1) if mape is not None else None,
                    "accuracy_5pct": round(accuracy_5pct, 1) if accuracy_5pct is not None else None,
                    "n_samples": len(preds),
                }

            # Dernières évaluations (pour le tableau de suivi)
            recent = []
            for r in rows[:30]:
                entry = {
                    "predicted_at": r["predicted_at"],
                    "target_at": r["target_at"],
                    "enseigne": r["enseigne"],
                    "salle": r["salle"],
                    "sensor_id": r["sensor_id"],
                    "predicted": {},
                    "actual": {},
                    "errors": {},
                }
                for t in TRACKED_TARGETS:
                    p = r[f"pred_{t}"]
                    a = r[f"actual_{t}"]
                    if p is not None:
                        entry["predicted"][t] = round(p, 1)
                    if a is not None:
                        entry["actual"][t] = round(a, 1)
                    if p is not None and a is not None:
                        entry["errors"][t] = round(abs(p - a), 1)
                recent.append(entry)

            return {
                "total_predictions": total,
                "evaluated": evaluated,
                "pending": total - evaluated,
                "metrics": metrics,
                "recent_evaluations": recent,
                "period_hours": hours,
            }

        finally:
            conn.close()


# ── Nettoyage des anciennes entrées ───────────────────────────
def cleanup_old(days: int = 30):
    """Supprime les prédictions évaluées de plus de N jours."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    with _lock:
        conn = _get_conn()
        try:
            result = conn.execute(
                "DELETE FROM predictions WHERE evaluated = 1 AND target_at < ?",
                (cutoff,),
            )
            conn.commit()
            deleted = result.rowcount
            if deleted:
                logger.info(f"🧹 {deleted} anciennes prédictions supprimées (>{days}j)")
        finally:
            conn.close()
