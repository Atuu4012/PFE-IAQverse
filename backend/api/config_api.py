"""
API endpoints pour la configuration de l'application
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pathlib import Path
from typing import List, Dict, Union, Optional
import logging
import shutil

from ..utils import load_config, save_config, load_user_config, save_user_config, extract_sensors_from_config
from ..core.supabase import supabase
from ..core import get_websocket_manager, settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])
security = HTTPBearer(auto_error=False) # Permet de ne pas crasher si pas de header, on gère manuellement

async def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    authorization: Optional[str] = Header(None)
) -> str:
    """ Extrait l'ID utilisateur du token JWT Supabase """
    if not supabase:
        return "local_user" # Mode dégradé si Supabase non configuré

    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication token required")

    try:
        user_response = supabase.auth.get_user(token)
        if user_response and user_response.user:
            return user_response.user.id
    except Exception as e:
        logger.error(f"Token validation failed: {e}")
    
    raise HTTPException(status_code=401, detail="Invalid authentication token")

def _get_assets_dir() -> Path:
    assets_dir = getattr(settings, "ASSETS_DIR", Path("assets"))
    return Path(assets_dir)


def _get_rooms_dir() -> Path:
    rooms_dir = getattr(settings, "ROOMS_DIR", _get_assets_dir() / "rooms")
    rooms_dir.mkdir(parents=True, exist_ok=True)
    return Path(rooms_dir)


def _normalize_glb_name(filename: str) -> str:
    name = Path(filename).name
    if not name.lower().endswith(".glb"):
        name = f"{Path(name).stem}.glb"
    return name


def _extract_paths(payload: Union[List[str], Dict[str, List[str]]]) -> List[str]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("paths") or payload.get("files") or payload.get("items") or []
    return []


def _sanitize_room_path(p: str, rooms_dir: Path) -> Path:
    name = str(p or "")
    if name.startswith("/"):
        name = name.lstrip("/")
    if name.startswith("assets/rooms/"):
        name = name[len("assets/rooms/"):]
    name = Path(name).name
    target = rooms_dir / name
    resolved = target.resolve()
    if resolved.parent != rooms_dir.resolve():
        raise ValueError("Path outside allowed directory")
    return target


async def _save_upload_file(file: UploadFile, target_path: Path) -> None:
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)


async def _broadcast_config_update(config: dict) -> None:
    try:
        manager = get_websocket_manager()
        await manager.broadcast({"type": "config_updated", "config": config}, topic="all")
    except Exception as e:
        logger.error(f"Failed to broadcast config update: {e}")


def _apply_config_updates(config: dict, updates: dict) -> dict:
    def update_config_recursive(base, upd):
        for k, v in upd.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                update_config_recursive(base[k], v)
            else:
                base[k] = v
    update_config_recursive(config, updates)
    return config


@router.post("/api/uploadAvatar")
async def upload_avatar(file: UploadFile = File(...)):
    """
    Upload d'un avatar utilisateur.
    Sauvegarde dans assets/icons/user_avatar.png (ou extension d'origine).
    """
    try:
        # Définir le dossier de destination
        # On suppose que le dossier assets est à la racine du projet, accessible via settings.BASE_DIR ou relatif
        # settings.ROOMS_DIR pointe vers assets/rooms, donc on peut remonter
        
        # Fallback si settings.ASSETS_DIR n'existe pas
        assets_dir = _get_assets_dir()
        
        icons_dir = assets_dir / "icons"
        icons_dir.mkdir(parents=True, exist_ok=True)
        
        # Nettoyer le nom de fichier ou utiliser un nom fixe pour l'utilisateur principal
        # Pour simplifier, on utilise un nom fixe avec l'extension d'origine
        ext = Path(file.filename).suffix
        if not ext:
            ext = ".png"
            
        filename = f"user_avatar{ext}"
        target_path = icons_dir / filename
        
        await _save_upload_file(file, target_path)
            
        # Retourner le chemin relatif pour le frontend
        relative_path = f"/assets/icons/{filename}"
        
        logger.info(f"Avatar uploaded to {target_path}")
        return {"path": relative_path}
        
    except Exception as e:
        logger.error(f"Error uploading avatar: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur upload avatar: {str(e)}")


@router.get("/api/config")
async def get_config(user_id: str = Depends(get_current_user_id)):
    """Retourne la configuration spécifique à l'utilisateur"""
    cfg = load_user_config(user_id)
    if cfg is None:
        raise HTTPException(status_code=500, detail="Impossible de charger la configuration")
    return cfg


@router.put("/api/config")
async def update_config(updates: dict = Body(...), user_id: str = Depends(get_current_user_id)):
    """Met à jour la configuration de l'utilisateur"""
    logger.info(f"Received config updates for user {user_id}")
    
    current_config = load_user_config(user_id)
    if not current_config:
        current_config = load_config() or {} # Fallback
    
    # Appliquer les mises à jour (fonction existante)
    def update_recursive(base, upd):
        for k, v in upd.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                update_recursive(base[k], v)
            else:
                base[k] = v
    update_recursive(current_config, updates)
    
    if save_user_config(user_id, current_config):
        # On broadcast uniquement à cet utilisateur idéalement, 
        # mais pour l'instant un broadcast global fonctionnera pour la démo
        await _broadcast_config_update(current_config)
            
        return {"message": "Configuration mise à jour", "config": current_config}
    raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")


@router.get("/api/config/sensors")
def get_sensors_config():
    """
    Retourne la liste des capteurs configurés. debug only.
    Extrait automatiquement depuis config.json.
    """
    try:
        config = load_config()
        if config is None:
            raise HTTPException(status_code=500, detail="Impossible de charger la configuration")
        
        sensors = extract_sensors_from_config(config)
        
        logger.info(f"GET /api/config/sensors: {len(sensors)} capteur(s) configuré(s)")
        
        return {"sensors": sensors}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur dans GET /api/config/sensors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/rooms/files")
async def upload_glb(file: UploadFile = File(...), filename: str = Form(...)):
    """
    Upload d'un fichier .glb via multipart/form-data.
    Le fichier est enregistré dans assets/rooms/.
    """
    try:
        if not filename or not filename.lower().endswith('.glb'):
            raise HTTPException(status_code=400, detail="Le nom de fichier doit se terminer par .glb")

        rooms_dir = _get_rooms_dir()
        safe_name = _normalize_glb_name(filename)
        target = rooms_dir / safe_name
        await _save_upload_file(file, target)

        rel = f"/assets/rooms/{safe_name}"
        logger.info(f"Uploaded GLB to {target}")
        return {"path": rel}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erreur lors de l'upload GLB: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'upload du fichier")


@router.delete("/api/rooms/files")
async def delete_room_files(payload: Union[List[str], Dict[str, List[str]]] = Body(...)):
    """
    Supprime des fichiers de pièces dans le dossier assets/rooms.
    Validation de sécurité pour éviter suppression arbitraire.
    """
    rooms_dir = _get_rooms_dir()
    
    deleted = []
    not_found = []
    errors = {}

    paths = _extract_paths(payload)
    logger.info(f"Request to delete files: {paths}")

    for p in paths:
        try:
            target = _sanitize_room_path(p, rooms_dir)
            if target.exists():
                target.unlink()
                deleted.append(f"/assets/rooms/{target.name}")
                logger.info(f"Deleted file: {target}")
            else:
                not_found.append(p)
                logger.warning(f"File not found: {target}")
        except Exception as e:
            errors[p] = str(e)
            logger.error(f"Error deleting {p}: {e}")
    
    return {"deleted": deleted, "not_found": not_found, "errors": errors}


@router.post("/api/config/module_state")
async def update_module_state(update_data: Dict, user_id: str = Depends(get_current_user_id)):
    """
    Mise à jour de l'état d'un module spécifique dans la configuration.
    """
    try:
        # Utilisez load_user_config au lieu de load_config
        config = load_user_config(user_id) 
        if not config:
            config = load_config() # Fallback

        enseigne_id = update_data.get("enseigne_id")
        piece_id = update_data.get("piece_id")
        module_id = update_data.get("module_id")
        new_state = update_data.get("state")
        
        updated = False
        
        if "lieux" in config and "enseignes" in config["lieux"]:
            for ens in config["lieux"]["enseignes"]:
                if ens.get("id") == enseigne_id or ens.get("nom") == enseigne_id:
                    for piece in ens.get("pieces", []):
                        if piece.get("id") == piece_id or piece.get("nom") == piece_id:
                            if "modules" not in piece:
                                piece["modules"] = []
                            
                            # Trouver le module
                            found = False
                            for mod in piece["modules"]:
                                if mod.get("id") == module_id:
                                    mod["state"] = new_state
                                    found = True
                                    updated = True
                                    break
                            
                            if not found:
                                # Le module n'existe pas encore, on l'ajoute avec des valeurs par défaut
                                new_module = {
                                    "id": module_id,
                                    "name": module_id.replace("_", " ").title(), # Basic naming
                                    "type": update_data.get("module_type", "unknown"),
                                    "is_iot": True, # Assume controllable by default if created via API
                                    "state": new_state
                                }
                                piece["modules"].append(new_module)
                                updated = True
                                logger.info(f"Created new module {module_id} in room {piece_id}")
        
        if updated:
            # Utilisez save_user_config
            save_user_config(user_id, config) 
            
            # Notifier via WebSocket
            # ...
            
            return {"status": "success", "message": "Module state updated"}
        else:
            return {"status": "ignored", "message": "No matching module found"}
            
    except Exception as e:
        logger.error(f"Error updating module state: {e}")
        raise HTTPException(status_code=500, detail=str(e))
