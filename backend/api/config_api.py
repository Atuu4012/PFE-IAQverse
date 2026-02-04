"""
API endpoints pour la configuration de l'application
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pathlib import Path
from typing import List, Dict, Union, Optional
import logging
import shutil


import os
import httpx
from ..utils import load_config, save_config, load_user_config, save_user_config, extract_sensors_from_config
from ..core.supabase import supabase
from ..core import get_websocket_manager, settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["config"])
security = HTTPBearer(auto_error=False) # Permet de ne pas crasher si pas de header, on gère manuellement

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    authorization: Optional[str] = Header(None)
) -> dict:
    """ Extrait l'objet utilisateur (avec ID et email) du token JWT Supabase """
    if not supabase:
        # En mode local/fallback, on renvoie une structure compatible
        return {"id": "local_user", "email": "local@iaqverse.com"}

    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication token required")

    try:
        sb_url = os.getenv("SUPABASE_URL")
        sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
        
        if sb_url and sb_key:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{sb_url}/auth/v1/user",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "ApiKey": sb_key
                    },
                    timeout=10.0
                )

                if response.status_code == 200:
                    user_data = response.json()
                    return user_data
                else:
                    logger.warning(f"Validation token échouée via API: {response.status_code} {response.text}")
        
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
    Upload d'un avatar utilisateur (Local).
    Sauvegarde dans assets/icons/user_avatar.png (Partagé).
    """
    try:
        # Retour au stockage local pour les icônes/avatars
        assets_dir = _get_assets_dir()
        
        icons_dir = assets_dir / "icons"
        icons_dir.mkdir(parents=True, exist_ok=True)
        
        ext = Path(file.filename).suffix or ".png"
            
        # Nom fixe "user_avatar" comme demandé
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


@router.delete("/api/auth/account")
async def delete_account(user: dict = Depends(get_current_user)):
    """
    Supprime le compte de l'utilisateur courant.
    Nécessite que le backend soit configuré avec la clé SERVICE_ROLE pour avoir les droits admin.
    """
    user_id = user["id"]
    if not supabase:
         raise HTTPException(status_code=503, detail="Supabase client not initialized")

    try:
        # Utilisation de l'API admin pour supprimer l'utilisateur
        # Note: supabase.auth.admin est disponible si la clé est un service_role
        logger.warning(f"Request to delete account for user {user_id}")
        
        # Admin delete
        response = supabase.auth.admin.delete_user(user_id)
        
        # On pourrait aussi nettoyer la config utilisateur ici
        # delete_user_config(user_id)
        
        logger.info(f"Account deleted successfully: {user_id}")
        return {"message": "Compte supprimé avec succès"}
        
    except Exception as e:
        logger.error(f"Error deleting account {user_id}: {e}")
        # Si la méthode admin n'est pas dispo (clé anon), on ne peut pas supprimer
        raise HTTPException(
            status_code=500, 
            detail="Impossible de supprimer le compte. Vérifiez la configuration serveur (Service Role requis) ou contactez le support."
        )

@router.get("/api/config")
async def get_config(user: dict = Depends(get_current_user)):
    """Retourne la configuration spécifique à l'utilisateur"""
    user_id = user["id"]
    cfg = load_user_config(user_id)
    
    # Auto-injection de l'email si manquant
    user_email = user.get("email")
    needs_save = False

    if cfg is None:
        # Retourner une config vierge par défaut au lieu de config.json
        cfg = {
            "vous": {"email": user_email} if user_email else {},
            "lieux": {"enseignes": []},
            "assurance": {},
            "syndicat": {},
            "notifications": {},
            "affichage": {"mode": "auto"}
        }
        needs_save = True
    else:
        # Si la config existe mais n'a pas l'email (ou s'il a changé?)
        vous = cfg.get("vous", {})
        if user_email and vous.get("email") != user_email:
            if "vous" not in cfg:
                cfg["vous"] = {}
            cfg["vous"]["email"] = user_email
            needs_save = True
            
    if needs_save:
        save_user_config(user_id, cfg)
        
    return cfg


@router.put("/api/config")
async def update_config(updates: dict = Body(...), user: dict = Depends(get_current_user)):
    """Met à jour la configuration de l'utilisateur"""
    user_id = user["id"]
    logger.info(f"Received config updates for user {user_id}")
    
    # Vérification explicite de la disponibilité du stockage
    if not supabase:
        logger.error("Attempt to update config but Supabase is not configured")
        raise HTTPException(
            status_code=503, 
            detail="Service de stockage indisponible. Veuillez configurer Supabase."
        )

    current_config = load_user_config(user_id)
    if not current_config:
         # Initialisation avec une config vierge si inexistante
        current_config = {
            "vous": {},
            "lieux": {"enseignes": []},
            "assurance": {},
            "syndicat": {},
            "notifications": {},
            "affichage": {"mode": "auto"}
        }
    
    # Appliquer les mises à jour (fonction existante)
    def update_recursive(base, upd):
        for k, v in upd.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                update_recursive(base[k], v)
            else:
                base[k] = v
    update_recursive(current_config, updates)
    
    # --- FIX RLS: On passe explicitement par save_user_config qui ajoute user_id ---
    if save_user_config(user_id, current_config):
        # On broadcast uniquement à cet utilisateur idéalement, 
        # mais pour l'instant un broadcast global fonctionnera pour la démo
        await _broadcast_config_update(current_config)
            
        return {"message": "Configuration mise à jour", "config": current_config}
    raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")


@router.get("/api/auth/config")
def get_auth_config():
    """Returns the public Supabase configuration for the frontend."""
    return {
        "supabaseUrl": settings.SUPABASE_URL,
        "supabaseKey": settings.SUPABASE_KEY
    }


@router.get("/api/config/sensors")
def get_sensors_config(user: dict = Depends(get_current_user)):
    """
    Retourne la liste des capteurs configurés.
    Extrait depuis la configuration utilisateur.
    """
    user_id = user["id"]
    try:
        config = load_user_config(user_id)
        if config is None:
             config = {} # Config vide
        
        sensors = extract_sensors_from_config(config)
        
        logger.info(f"GET /api/config/sensors: {len(sensors)} capteur(s) configuré(s)")
        
        return {"sensors": sensors}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erreur dans GET /api/config/sensors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/rooms/files")
async def upload_glb(
    file: UploadFile = File(...), 
    filename: str = Form(...),
    user: dict = Depends(get_current_user)
):
    """
    Upload d'un fichier .glb vers Supabase Storage.
    Bucket: 'assets'
    Path: '{user_id}/rooms/{filename}'
    """
    user_id = user["id"]
    try:
        if not filename or not filename.lower().endswith('.glb'):
            raise HTTPException(status_code=400, detail="Le nom de fichier doit se terminer par .glb")
            
        # Lire le fichier
        content = await file.read()
        safe_name = _normalize_glb_name(filename)
        bucket_name = "assets"
        storage_path = f"{user_id}/rooms/{safe_name}"

        if supabase:
            try:
                # Upload vers Supabase Storage
                res = supabase.storage.from_(bucket_name).upload(
                    path=storage_path,
                    file=content,
                    file_options={"content-type": "model/gltf-binary", "upsert": "true"}
                )
                
                public_url = supabase.storage.from_(bucket_name).get_public_url(storage_path)
                logger.info(f"GLB uploaded to Supabase Storage: {public_url}")
                return {"path": public_url}
                
            except Exception as storage_error:
                logger.error(f"Supabase Storage GLB Error: {storage_error}")
                raise HTTPException(status_code=500, detail=f"Stockage distant indisponible: {storage_error}")
        
        else:
            # Fallback Local
            logger.warning("Supabase non configuré, fallback sur stockage local GLB")
            rooms_dir = _get_rooms_dir()
            target = rooms_dir / safe_name
            
            with target.open("wb") as buffer:
                buffer.write(content)

            rel = f"/assets/rooms/{safe_name}"
            return {"path": rel}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Erreur lors de l'upload GLB: {e}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'upload du fichier")


@router.delete("/api/rooms/files")
async def delete_room_files(
    payload: Union[List[str], Dict[str, List[str]]] = Body(...),
    user: dict = Depends(get_current_user)
):
    """
    Supprime des fichiers de pièces (Supabase Storage ou Local).
    """
    user_id = user["id"]
    deleted = []
    not_found = []
    errors = {}

    paths = _extract_paths(payload)
    logger.info(f"Request to delete files by user {user_id}: {paths}")
    
    bucket_name = "assets"

    for p in paths:
        try:
            # Détection si c'est une URL Supabase ou un chemin local
            is_supabase_url = "supabase" in p and "/storage/v1/object/public/" in p
            
            if is_supabase_url and supabase:
                # Extraction du path relatif dans le bucket
                # Format URL: .../public/assets/{user_id}/rooms/file.glb
                # On veut: {user_id}/rooms/file.glb
                if f"/public/{bucket_name}/" in p:
                    storage_path = p.split(f"/public/{bucket_name}/")[1]
                    
                    # Sécurité simple: vérifier que le path commence par le user_id
                    if not storage_path.startswith(f"{user_id}/"):
                        logger.warning(f"User {user_id} tried to delete asset of another user: {storage_path}")
                        errors[p] = "Permission denied"
                        continue

                    # Suppression Supabase
                    supabase.storage.from_(bucket_name).remove([storage_path])
                    deleted.append(p)
                    logger.info(f"Deleted from Supabase Storage: {storage_path}")
                else:
                    errors[p] = "Invalid Supabase URL structure"

            else:
                # Gestion Suppression Locale (Legacy ou Fallback)
                # On évite de laisser supprimer n'importe quoi sur le disque
                if p.startswith("http") or ".." in p:
                    # Ignorer les URLs qui ne sont pas identifiées comme Supabase ou chemins suspects
                    continue
                    
                rooms_dir = _get_rooms_dir()
                target = _sanitize_room_path(p, rooms_dir)
                if target.exists():
                    target.unlink()
                    deleted.append(f"/assets/rooms/{target.name}")
                    logger.info(f"Deleted local file: {target}")
                else:
                    not_found.append(p)

        except Exception as e:
            errors[p] = str(e)
            logger.error(f"Error deleting {p}: {e}")
    
    return {"deleted": deleted, "not_found": not_found, "errors": errors}


@router.post("/api/config/module_state")
async def update_module_state(update_data: Dict, user: dict = Depends(get_current_user)):
    """
    Mise à jour de l'état d'un module spécifique dans la configuration.
    """
    user_id = user["id"]
    try:
        # Utilisez load_user_config au lieu de load_config
        config = load_user_config(user_id) 
        if not config:
            raise HTTPException(status_code=404, detail="Configuration utilisateur non trouvée")

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
