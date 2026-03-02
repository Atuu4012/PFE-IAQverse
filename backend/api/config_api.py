"""
API endpoints pour la configuration de l'application
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pathlib import Path
from typing import List, Dict, Union, Optional, Any
from pydantic import BaseModel, Field
import logging
import json


import os
import httpx
from ..utils import (
    load_user_config,
    save_user_config,
    update_user_config_partial,
    extract_sensors_from_config,
)
from ..core.supabase import supabase
from ..core import get_websocket_manager, settings

logger = logging.getLogger(__name__)

# Cache JWKS en mémoire pour éviter les appels réseau répétés (ES256/ECC)
_jwks_cache: dict = {}

# Cache de configuration par user_id (TTL 60s) pour éviter les appels Supabase
# répétés à chaque navigation de page
import time as _time
_config_cache: dict = {}  # {user_id: {"data": cfg, "ts": float}}
CONFIG_CACHE_TTL = 60  # secondes

router = APIRouter(tags=["config"])
security = HTTPBearer(auto_error=False) # Permet de ne pas crasher si pas de header, on gère manuellement


# --- Pydantic Models for Configuration ---
class ModuleSchema(BaseModel):
    id: str
    name: str
    type: str
    state: str
    is_iot: Optional[bool] = False

class PieceSchema(BaseModel):
    id: str
    nom: str
    type: Optional[str] = None
    area: Optional[float] = None
    glbModel: Optional[str] = None
    modules: Optional[List[ModuleSchema]] = []

class EnseigneSchema(BaseModel):
    id: str
    nom: str
    adresse: Optional[str] = None
    pieces: Optional[List[PieceSchema]] = []

class LieuxSchema(BaseModel):
    active: Optional[str] = None
    activeRoom: Optional[str] = None
    enseignes: Optional[List[EnseigneSchema]] = []

class AffichageSchema(BaseModel):
    mode: Optional[str] = None
    langue: Optional[str] = None
    lastSection: Optional[str] = None
    localisation: Optional[str] = None

class ConfigUpdatePayload(BaseModel):
    """
    Modèle de validation pour la mise à jour de la configuration globale.
    Chaque section est optionnelle pour permettre des mises à jour partielles.
    """
    vous: Optional[Dict[str, Any]] = None
    lieux: Optional[LieuxSchema] = None
    affichage: Optional[AffichageSchema] = None
    assurance: Optional[Dict[str, Any]] = None
    syndicat: Optional[Dict[str, Any]] = None
    abonnement: Optional[Dict[str, Any]] = None
    digital_twin: Optional[Dict[str, Any]] = None
    notifications: Optional[Dict[str, Any]] = None

    model_config = {
        "extra": "ignore"  # Ignore les champs non définis (ex: 'message', 'config')
    }
# -----------------------------------------

@router.get("/api/i18n/{lang}")
async def get_i18n(lang: str):
    """Retourne le dictionnaire i18n pour une langue donnée."""
    normalized = (lang or "").strip().lower()
    if not normalized or len(normalized) > 10:
        raise HTTPException(status_code=400, detail="Invalid language")

    i18n_file = _get_assets_dir() / "i18n" / f"{normalized}.json"
    if not i18n_file.exists():
        raise HTTPException(status_code=404, detail="Language not found")

    try:
        return json.loads(i18n_file.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Failed to load i18n file {i18n_file}: {e}")
        raise HTTPException(status_code=500, detail="Unable to load language")

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    authorization: Optional[str] = Header(None)
) -> dict:
    """ Extrait l'objet utilisateur (avec ID et email) du token JWT Supabase.

    Détecte automatiquement l'algorithme dans le header JWT :
    - HS256 → vérifie avec SUPABASE_JWT_SECRET (0 appel réseau)
    - ES256 → vérifie avec la clé publique JWKS de Supabase (cachée en mémoire)
    - Fallback → appel HTTP /auth/v1/user (lent, si rien d'autre n'est dispo)
    """
    if not supabase:
        return {"id": "local_user", "email": "local@iaqverse.com"}

    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication token required")

    import jwt as pyjwt

    # Lire l'entête du token sans vérification pour connaître l'algo
    try:
        header = pyjwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
    except pyjwt.DecodeError as e:
        raise HTTPException(status_code=401, detail=f"Token malformé : {e}")

    try:
        if alg == "ES256":
            sb_url = settings.SUPABASE_URL or os.getenv("SUPABASE_URL", "")
            jwks_url = f"{sb_url}/auth/v1/.well-known/jwks.json"

            if jwks_url not in _jwks_cache:
                logger.info(f"Chargement JWKS depuis {jwks_url}")
                async with httpx.AsyncClient() as client:
                    resp = await client.get(jwks_url, timeout=10.0)
                    resp.raise_for_status()
                    _jwks_cache[jwks_url] = resp.json()

            jwks = pyjwt.PyJWKClient.__new__(pyjwt.PyJWKClient)
            # Utilise PyJWKSet pour charger les clés depuis le dict en cache
            from jwt import PyJWKSet
            key_set = PyJWKSet.from_dict(_jwks_cache[jwks_url])
            # Cherche la clé correspondant au kid du token
            kid = header.get("kid")
            signing_key = None
            for k in key_set.keys:
                if kid is None or k.key_id == kid:
                    signing_key = k.key
                    break
            if signing_key is None:
                # Clé non trouvée → invalider le cache et lever une erreur
                _jwks_cache.pop(jwks_url, None)
                raise HTTPException(status_code=401, detail="Clé JWKS introuvable pour ce token")

            payload = pyjwt.decode(
                token, signing_key,
                algorithms=["ES256"],
                options={"verify_aud": False}
            )

        else:
            raise HTTPException(status_code=401, detail=f"Algorithme JWT non supporté : {alg}")

        user_id = payload.get("sub")
        email   = payload.get("email", "")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token invalide : sub manquant")
        return {"id": user_id, "email": email}

    except HTTPException:
        raise
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expiré")
    except pyjwt.InvalidTokenError as e:
        # Si la clé JWKS est périmée, on vide le cache pour forcer un rechargement
        if alg == "ES256":
            sb_url = settings.SUPABASE_URL or os.getenv("SUPABASE_URL", "")
            _jwks_cache.pop(f"{sb_url}/auth/v1/.well-known/jwks.json", None)
        raise HTTPException(status_code=401, detail=f"Token invalide : {e}")
    except Exception as e:
        logger.error(f"Erreur inattendue lors de la validation JWT ({alg}): {e}")
        # Fallback HTTP Supabase en dernier recours
        logger.warning("Fallback validation JWT via HTTP Supabase")
        try:
            sb_url = os.getenv("SUPABASE_URL")
            sb_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
            if sb_url and sb_key:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        f"{sb_url}/auth/v1/user",
                        headers={"Authorization": f"Bearer {token}", "ApiKey": sb_key},
                        timeout=10.0
                    )
                    if response.status_code == 200:
                        return response.json()
        except Exception as fallback_err:
            logger.error(f"Fallback HTTP aussi échoué : {fallback_err}")
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
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """
    Upload d'un avatar utilisateur (Supabase Storage).
    Bucket: 'assets'
    Path: '{user_id}/avatar.{ext}'
    """
    try:
        if not supabase:
            raise HTTPException(status_code=503, detail="Supabase non configuré")

        user_id = user.get("id")
        if not user_id:
            raise HTTPException(status_code=400, detail="Utilisateur invalide")

        ext = Path(file.filename).suffix.lower() or ".png"
        if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
            ext = ".png"

        # Nom par utilisateur pour eviter l'ecrasement entre comptes
        filename = f"avatar{ext}"
        storage_path = f"{user_id}/{filename}"
        bucket_name = "assets"

        content = await file.read()
        content_type = file.content_type or "image/png"

        try:
            # Supprimer les anciens avatars pour eviter les doublons et cache stale
            try:
                existing = supabase.storage.from_(bucket_name).list(path=str(user_id)) or []
                to_remove = []
                for item in existing:
                    name = item.get("name") if isinstance(item, dict) else None
                    if name and name.startswith("avatar"):
                        to_remove.append(f"{user_id}/{name}")
                if to_remove:
                    supabase.storage.from_(bucket_name).remove(to_remove)
            except Exception as cleanup_error:
                logger.warning(f"Avatar cleanup failed: {cleanup_error}")

            supabase.storage.from_(bucket_name).upload(
                path=storage_path,
                file=content,
                file_options={"content-type": content_type, "upsert": "true"}
            )
        except Exception as storage_error:
            logger.error(f"Supabase Storage avatar error: {storage_error}")
            raise HTTPException(status_code=500, detail=f"Stockage distant indisponible: {storage_error}")

        public_url = supabase.storage.from_(bucket_name).get_public_url(storage_path)
        relative_path = public_url

        # Mettre a jour la config utilisateur pour garder l'avatar associe
        try:
            cfg = load_user_config(user_id) or {}
            if "vous" not in cfg or not isinstance(cfg.get("vous"), dict):
                cfg["vous"] = {}
            cfg["vous"]["avatar"] = relative_path
            save_user_config(user_id, cfg)
        except Exception as e:
            logger.warning(f"Unable to persist avatar path in config: {e}")

        logger.info(f"Avatar uploaded to Supabase Storage: {relative_path}")
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
    """Retourne la configuration spécifique à l'utilisateur.
    Cache TTL 60s en mémoire par user_id pour éviter les appels Supabase répétés.
    """
    user_id = user["id"]

    # --- Lecture du cache ---
    cached = _config_cache.get(user_id)
    if cached and (_time.monotonic() - cached["ts"]) < CONFIG_CACHE_TTL:
        logger.debug(f"[config] Cache HIT pour user {user_id}")
        return cached["data"]

    cfg = load_user_config(user_id)
    
    # Auto-injection de l'email si manquant
    user_email = user.get("email")
    needs_save = False

    # Nettoyage préventif des données imbriquées suite à un potentiel bug
    if cfg is not None:
        if "message" in cfg:
            cfg.pop("message", None)
            needs_save = True
        while "config" in cfg and isinstance(cfg["config"], dict):
            if any(k in cfg["config"] for k in ["vous", "lieux", "assurance", "affichage", "notifications"]):
                cfg = cfg["config"]
            else:
                cfg.pop("config", None)
            needs_save = True

    if cfg is None:
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
        vous = cfg.get("vous", {})
        if user_email and vous.get("email") != user_email:
            if "vous" not in cfg:
                cfg["vous"] = {}
            cfg["vous"]["email"] = user_email
            needs_save = True

    # Résolution avatar depuis Supabase Storage (seulement si l'avatar est absent)
    try:
        avatar_path = cfg.get("vous", {}).get("avatar") if cfg else None

        if supabase and not avatar_path:
            bucket_name = "assets"
            try:
                items = supabase.storage.from_(bucket_name).list(path=str(user_id)) or []
                for item in items:
                    name = item.get("name") if isinstance(item, dict) else None
                    if name and name.startswith("avatar"):
                        public_url = supabase.storage.from_(bucket_name).get_public_url(f"{user_id}/{name}")
                        if "vous" not in cfg or not isinstance(cfg.get("vous"), dict):
                            cfg["vous"] = {}
                        cfg["vous"]["avatar"] = public_url
                        needs_save = True
                        break
            except Exception as e:
                logger.warning(f"Avatar lookup in Supabase failed: {e}")
    except Exception as e:
        logger.warning(f"Avatar resolution failed: {e}")

    if needs_save:
        save_user_config(user_id, cfg)

    # --- Écriture du cache ---
    _config_cache[user_id] = {"data": cfg, "ts": _time.monotonic()}
    logger.debug(f"[config] Cache MISS, config mise en cache pour user {user_id}")

    return cfg



@router.put("/api/config")
async def update_config(payload: ConfigUpdatePayload, user: dict = Depends(get_current_user)):
    """Met à jour la configuration de l'utilisateur"""
    user_id = user["id"]
    logger.info(f"Received config updates for user {user_id}")
    # Invalider le cache pour que le prochain GET aille chercher en DB
    _config_cache.pop(user_id, None)
    
    # Transformation de l'objet pydantic validé en dictionnaire (en excluant les champs non soumis)
    updates = payload.model_dump(exclude_unset=True)

    # Vérification explicite de la disponibilité du stockage
    if not supabase:
        logger.error("Attempt to update config but Supabase is not configured")
        raise HTTPException(
            status_code=503, 
            detail="Service de stockage indisponible. Veuillez configurer Supabase."
        )

    ok, current_config = update_user_config_partial(user_id, updates)
    if ok:
        if not current_config:
            current_config = {
                "vous": {},
                "lieux": {"enseignes": []},
                "assurance": {},
                "notifications": {},
                "affichage": {"mode": "auto"},
                "digital_twin": {},
                "abonnement": {},
            }
        # On broadcast uniquement à cet utilisateur idéalement, 
        # mais pour l'instant un broadcast global fonctionnera pour la démo
        await _broadcast_config_update(current_config)
            
        return {"message": "Configuration mise à jour", "config": current_config}
    raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde")


@router.get("/api/auth/config")
def get_auth_config():
    """Returns the public Supabase configuration for the frontend."""
    supabase_url = settings.SUPABASE_URL or os.getenv("SUPABASE_URL")
    supabase_public_key = (
        settings.SUPABASE_PUBLISHABLE_KEY
        or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        settings.SUPABASE_ANON_KEY
        or os.getenv("SUPABASE_ANON_KEY")
        or settings.SUPABASE_KEY
        or os.getenv("SUPABASE_KEY")
    )

    if not supabase_url or not supabase_public_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase auth configuration is missing (SUPABASE_URL and/or SUPABASE_ANON_KEY/SUPABASE_KEY)."
        )

    return {
        "supabaseUrl": supabase_url,
        "supabaseKey": supabase_public_key
    }


@router.get("/api/config/sensors")
def get_sensors_config(user: dict = Depends(get_current_user)):
    """
    Retourne la liste des capteurs configurés.
    Extrait depuis la configuration utilisateur.
    """
    user_id = user["id"]
    try:
        config = load_user_config(user_id, sections={"lieux"})
        if config is None:
            config = {"lieux": {"enseignes": []}} # Config vide
        
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
            raise HTTPException(status_code=503, detail="Supabase non configuré. Stockage distant requis en production.")
            
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
        config = load_user_config(user_id, sections={"lieux"}) 
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
            # Écrit uniquement la colonne lieux
            ok, _ = update_user_config_partial(user_id, {"lieux": config.get("lieux", {})})
            if not ok:
                raise HTTPException(status_code=500, detail="Erreur lors de la sauvegarde des modules")
            
            # Notifier via WebSocket
            # ...
            
            return {"status": "success", "message": "Module state updated"}
        else:
            return {"status": "ignored", "message": "No matching module found"}
            
    except Exception as e:
        logger.error(f"Error updating module state: {e}")
        raise HTTPException(status_code=500, detail=str(e))
