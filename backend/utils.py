"""
Fonctions utilitaires pour l'API FastAPI
"""

from pathlib import Path
from typing import Optional, Iterable, Dict, Any
import pandas as pd
import numpy as np
import math
import json
import logging
from .core.supabase import supabase

logger = logging.getLogger("uvicorn.error")




def sanitize_for_storage(d: dict) -> dict:
    """
    Prepare un enregistrement pour stockage JSON-friendly.
    Convertit datetime -> ISO, NaN/inf -> None, numpy -> Python natif.
    """
    out = {}
    for k, v in d.items():
        if isinstance(v, pd.Timestamp):
            out[k] = v.isoformat()
            continue
        try:
            if pd.isna(v):
                out[k] = None
                continue
        except Exception:
            pass
        if isinstance(v, np.generic):
            try:
                v = v.item()
            except Exception:
                pass
        if isinstance(v, float):
            if not math.isfinite(v):
                out[k] = None
                continue
        out[k] = v
    return out


def find_col(cols_map, key_candidates):
    """Trouve une colonne dans un dictionnaire de colonnes."""
    for k in key_candidates:
        for k0, v in cols_map.items():
            if k in k0:
                return v
    return None


def load_dataset_df(path: Optional[Path] = None) -> Optional[pd.DataFrame]:
    """
    Charge le CSV et retourne un DataFrame standardise.
    Colonnes: timestamp, co2, pm25, tvoc, temperature, humidity
    """
    DATA_DIR = Path(__file__).parent.parent / "assets" / "datasets" / "IoT_Indoor_Air_Quality_Dataset.csv"
    p = Path(path) if path else DATA_DIR
    
    if not p or not p.exists():
        return None

    df = pd.read_csv(p)
    cols = {c.lower(): c for c in df.columns}

    ts_col = find_col(cols, ["timestamp", "time", "date", "datetime"])
    co2_col = find_col(cols, ["co2", "co_2"])
    pm25_col = find_col(cols, ["pm2.5", "pm25", "pm_2_5", "pm2"])
    tvoc_col = find_col(cols, ["tvoc"])
    temp_col = find_col(cols, ["temperature", "temp"])
    hum_col = find_col(cols, ["humidity", "hum"])

    out = pd.DataFrame()
    
    if ts_col:
        out["timestamp"] = pd.to_datetime(df[ts_col], dayfirst=True, errors="coerce")
    else:
        out["timestamp"] = pd.NaT
    
    def to_num(col):
        return pd.to_numeric(df[col], errors="coerce") if col else pd.Series([pd.NA]*len(df))

    out["co2"] = to_num(co2_col)
    out["pm25"] = to_num(pm25_col)
    out["tvoc"] = to_num(tvoc_col)
    out["temperature"] = to_num(temp_col)
    out["humidity"] = to_num(hum_col)
    out["enseigne"] = "Maison"
    out["salle"] = "Chambre"
    out["capteur_id"] = "Chambre1"

    out = out.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

    try:
        if out["timestamp"].dt.tz is None:
            out["timestamp"] = out["timestamp"].dt.tz_localize("UTC")
        else:
            out["timestamp"] = out["timestamp"].dt.tz_convert("UTC")
    except Exception:
        pass
    
    return out





def extract_sensors_from_config(config):
    """
    Extrait la liste des capteurs depuis la configuration.
    
    Format de retour:
    [
        {"enseigne": "Maison", "salle": "Chambre", "capteur_id": "Chambre1"},
        ...
    ]
    """
    sensors = []
    
    if not config:
        return sensors
    
    enseignes = config.get("lieux", {}).get("enseignes", [])
    
    for enseigne in enseignes:
        enseigne_nom = enseigne.get("nom", "Unknown")
        pieces = enseigne.get("pieces", [])
        
        for piece in pieces:
            piece_nom = piece.get("nom", "Unknown")
            piece_id = piece.get("id", piece_nom)
            capteurs = piece.get("capteurs", [])
            
            if not capteurs:
                capteurs = [f"{piece_nom}1"]
            
            for capteur_id in capteurs:
                sensors.append({
                    "enseigne": enseigne_nom,
                    "salle": piece_nom,
                    "capteur_id": capteur_id,
                    "piece_id": piece_id
                })
    
    return sensors


CONFIG_SECTION_TO_COLUMN = {
    "vous": "profile",
    "lieux": "lieux",
    "affichage": "preferences",
    "notifications": "preferences",
    "digital_twin": "preferences",
    "abonnement": "abonnement",
    "assurance": "assurance",
}

PREFERENCES_SECTIONS = {"affichage", "notifications", "digital_twin"}
DEFAULT_CONFIG_COLUMNS = ["profile", "lieux", "preferences", "abonnement", "assurance"]


def _deep_merge_dict(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base or {})
    for key, value in (updates or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dict(merged[key], value)
        else:
            merged[key] = value
    return merged


def _columns_for_sections(sections: Optional[Iterable[str]]) -> list[str]:
    if not sections:
        return list(DEFAULT_CONFIG_COLUMNS)

    columns = []
    for section in sections:
        col = CONFIG_SECTION_TO_COLUMN.get(section)
        if col and col not in columns:
            columns.append(col)
    return columns or list(DEFAULT_CONFIG_COLUMNS)


def _write_user_config_columns(user_id: str, column_values: Dict[str, Any]) -> bool:
    if not supabase:
        return False

    if not column_values:
        return True

    try:
        exists_resp = (
            supabase.table("user_configs")
            .select("user_id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        exists = bool(exists_resp.data)

        if exists:
            (
                supabase.table("user_configs")
                .update(column_values)
                .eq("user_id", user_id)
                .execute()
            )
        else:
            payload = {"user_id": user_id, **column_values}
            supabase.table("user_configs").insert(payload).execute()
        return True
    except Exception as e:
        logger.error(f"Erreur écriture Supabase pour {user_id}: {e}")
        return False


def load_user_config(user_id: str, sections: Optional[Iterable[str]] = None):
    """Charge la configuration depuis Supabase pour un utilisateur spécifique.
    
    Lit les colonnes dédiées (profile, lieux, preferences, abonnement, assurance)
    et reconstruit un dictionnaire unifié identique à l'ancien format.
    """
    if not supabase:
        return None  # Pas de supabase, pas de config user

    columns = _columns_for_sections(sections)

    response = (
        supabase.table("user_configs")
        .select(", ".join(columns))
        .eq("user_id", user_id)
        .execute()
    )

    # Si l'utilisateur n'a pas encore de config, on renvoie None
    if not response.data:
        return None

    row = response.data[0]
    prefs = row.get("preferences") or {}

    section_set = set(sections) if sections else None

    config = {}
    if section_set is None or "vous" in section_set:
        config["vous"] = row.get("profile") or {}
    if section_set is None or "lieux" in section_set:
        config["lieux"] = row.get("lieux") or {"enseignes": []}
    if section_set is None or "affichage" in section_set:
        config["affichage"] = prefs.get("affichage") or {}
    if section_set is None or "notifications" in section_set:
        config["notifications"] = prefs.get("notifications") or {}
    if section_set is None or "digital_twin" in section_set:
        config["digital_twin"] = prefs.get("digital_twin") or {}
    if section_set is None or "abonnement" in section_set:
        config["abonnement"] = row.get("abonnement") or {}
    if section_set is None or "assurance" in section_set:
        config["assurance"] = row.get("assurance") or {}

    return config


def update_user_config_partial(user_id: str, updates: dict):
    """Met à jour uniquement les colonnes impactées par les sections modifiées."""
    if not supabase:
        logger.error(f"Supabase non configuré. Échec sauvegarde partielle pour user {user_id}")
        return False, None

    updates = updates or {}
    column_patches: Dict[str, Any] = {}

    if "vous" in updates:
        column_patches["profile"] = updates.get("vous") or {}
    if "lieux" in updates:
        column_patches["lieux"] = updates.get("lieux") or {}
    if "abonnement" in updates:
        column_patches["abonnement"] = updates.get("abonnement") or {}
    if "assurance" in updates:
        column_patches["assurance"] = updates.get("assurance") or {}

    preferences_patch = {
        key: updates[key]
        for key in PREFERENCES_SECTIONS
        if key in updates
    }
    if preferences_patch:
        column_patches["preferences"] = preferences_patch

    if not column_patches:
        return True, load_user_config(user_id)

    existing_resp = (
        supabase.table("user_configs")
        .select(", ".join(column_patches.keys()))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    existing_row = existing_resp.data[0] if existing_resp.data else {}

    column_values: Dict[str, Any] = {}
    for column, patch in column_patches.items():
        current_value = existing_row.get(column)
        if isinstance(current_value, dict) and isinstance(patch, dict):
            column_values[column] = _deep_merge_dict(current_value, patch)
        else:
            column_values[column] = patch

    ok = _write_user_config_columns(user_id, column_values)
    if not ok:
        return False, None

    return True, load_user_config(user_id)

def save_user_config(user_id: str, new_config: dict):
    """Sauvegarde la configuration d'un utilisateur dans les colonnes dédiées.
    
    Distribue les sections du dict unifié dans leurs colonnes respectives :
      - profile      ← "vous"
      - lieux        ← "lieux"
      - preferences  ← { affichage, notifications, digital_twin }
      - abonnement   ← "abonnement"
      - assurance    ← "assurance"
    """
    if not supabase:
        logger.error(f"Supabase non configure. Echec sauvegarde pour user {user_id}")
        return False

    try:
        data = {}
        if "vous" in new_config:
            data["profile"] = new_config.get("vous") or {}
        if "lieux" in new_config:
            data["lieux"] = new_config.get("lieux") or {}
        if "abonnement" in new_config:
            data["abonnement"] = new_config.get("abonnement") or {}
        if "assurance" in new_config:
            data["assurance"] = new_config.get("assurance") or {}

        preferences = {
            k: new_config[k]
            for k in PREFERENCES_SECTIONS
            if k in new_config
        }
        if preferences:
            data["preferences"] = preferences

        if not _write_user_config_columns(user_id, data):
            return False
        return True
    except Exception as e:
        logger.error(f"Erreur sauvegarde Supabase pour {user_id}: {e}")
        return False
