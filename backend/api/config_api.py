"""
API endpoints pour la configuration de l'application
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pathlib import Path
from typing import List, Dict
import logging

from ..utils import load_config, save_config, extract_sensors_from_config


logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])


@router.get("/api/locations")
def get_locations():
    """
    Retourne les emplacements disponibles (enseignes et salles) à partir des données
    """
    try:
        config = load_config()
        if not config:
            return {}
            
        sensors = extract_sensors_from_config(config)
        
        locations: Dict[str, List[str]] = {}
        
        for s in sensors:
            enseigne = s.get("enseigne")
            salle = s.get("salle")
            
            if enseigne and salle:
                if enseigne not in locations:
                    locations[enseigne] = []
                if salle not in locations[enseigne]:
                    locations[enseigne].append(salle)
        
        logger.info(f"Locations disponibles (config): {locations}")
        return locations
        
    except Exception as e:
        logger.error(f"Erreur lors de la récupération des locations: {e}")
        return {}


@router.get("/config")
def get_config():
    """Retourne la configuration complète de l'application"""
    config = load_config()
    if config is None:
        raise HTTPException(status_code=500, detail="Impossible de charger la configuration")
    return config


@router.post("/api/saveConfig")
async def save_config_endpoint(updates: dict):
    """Sauvegarde les modifications de la configuration"""
    logger.info(f"Received config updates: {list(updates.keys())}")
    config = load_config()
    if config is None:
        raise HTTPException(status_code=500, detail="Impossible de charger la configuration")
    
    def update_config(base, updates):
        for key, value in updates.items():
            if isinstance(value, dict) and key in base and isinstance(base[key], dict):
                update_config(base[key], value)
            else:
                base[key] = value
    
    update_config(config, updates)
    
    if save_config(config):
        return {"message": "Configuration mise à jour", "config": config}
    raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")


@router.get("/api/sensors-config")
def get_sensors_config():
    """
    Retourne la liste des capteurs configurés.
    Extrait automatiquement depuis config.json.
    """
    try:
        config = load_config()
        if config is None:
            raise HTTPException(status_code=500, detail="Impossible de charger la configuration")
        
        sensors = extract_sensors_from_config(config)
        
        logger.info(f"GET /api/sensors-config: {len(sensors)} capteur(s) configuré(s)")
        
        return {"sensors": sensors}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur dans GET /api/sensors-config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/uploadGlb")
async def upload_glb(file: UploadFile = File(...), filename: str = Form(...)):
    """
    Upload d'un fichier .glb via multipart/form-data.
    Le fichier est enregistré dans assets/rooms/.
    """
    try:
        if not filename.lower().endswith('.glb'):
            raise HTTPException(status_code=400, detail="Le nom de fichier doit se terminer par .glb")

        from ..core import settings
        rooms_dir = settings.ROOMS_DIR
        rooms_dir.mkdir(parents=True, exist_ok=True)

        safe_name = Path(filename).name
        target = rooms_dir / safe_name

        contents = await file.read()
        with open(target, 'wb') as f:
            f.write(contents)

        rel = f"/assets/rooms/{safe_name}"
        logger.info(f"Uploaded GLB to {target}")
        return {"path": rel}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erreur lors de l'upload GLB: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'upload du fichier")


@router.post("/api/deleteFiles")
async def delete_files(paths: List[str]):
    """
    Supprime des fichiers listés dans le dossier assets/rooms.
    Validation de sécurité pour éviter suppression arbitraire.
    """
    from ..core import settings
    rooms_dir = settings.ROOMS_DIR
    rooms_dir.mkdir(parents=True, exist_ok=True)
    
    deleted = []
    not_found = []
    errors = {}
    
    for p in paths:
        try:
            name = str(p or '')
            if name.startswith('/'):
                name = name.lstrip('/')
            if name.startswith('assets/rooms/'):
                name = name[len('assets/rooms/'):]
            name = Path(name).name
            target = rooms_dir / name
            
            try:
                resolved = target.resolve()
            except Exception as e:
                errors[p] = f"Invalid path: {e}"
                continue
            
            if resolved.parent != rooms_dir.resolve():
                errors[p] = 'Path outside allowed directory'
                continue
            
            if target.exists():
                target.unlink()
                deleted.append(f"/assets/rooms/{name}")
            else:
                not_found.append(p)
        except Exception as e:
            errors[p] = str(e)
    
    return {"deleted": deleted, "not_found": not_found, "errors": errors}
