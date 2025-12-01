"""
Fonctions utilitaires pour l'API FastAPI
"""

from pathlib import Path
from typing import Optional
import pandas as pd
import numpy as np
import math
import json
import logging

logger = logging.getLogger("uvicorn.error")

CONFIG_PATH = Path(__file__).resolve().parent.parent / 'assets' / 'config.json'


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


def load_config():
    """Charge le fichier de configuration principal."""
    try:
        if not CONFIG_PATH.exists():
            logger.warning(f"Fichier de configuration introuvable: {CONFIG_PATH}")
            return None
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return cfg
    except Exception as e:
        logger.error(f"Erreur lors du chargement de la configuration : {e}")
        return None


def save_config(config):
    """Sauvegarde le fichier de configuration principal."""
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONFIG_PATH.with_suffix('.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=4)
        tmp.replace(CONFIG_PATH)
        logger.info(f"Configuration sauvegardee dans {CONFIG_PATH}")
        return True
    except Exception as e:
        logger.error(f"Erreur lors de la sauvegarde de la configuration : {e}")
        return False


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
