"""
API FastAPI pour le système IAQverse - Version 2.0
Architecture modulaire et microservices
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from typing import Optional, List, Dict, Any
import asyncio
import logging
import re
import unicodedata
import pandas as pd
import numpy as np
from datetime import datetime, timezone

# Import des modules core
from .core import settings, get_influx_client, get_websocket_manager
from .core.supabase import supabase, log_supabase_status

# Import des routers API
from .api import (
    ingest_router,
    query_router,
    config_router
)

# Import des utilitaires
from .utils import load_dataset_df, load_user_config, save_user_config
from .api.config_api import get_current_user

# Configuration du logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn.error")
log_supabase_status()

# Création de l'application FastAPI
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Plateforme IAQ avec jumeau numérique, ML et IoT"
)

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enregistrement des routers
app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(config_router)

# Chargement du dataset au démarrage
DATA_DF = load_dataset_df()

# Tâche de posting périodique
posting_task: Optional[asyncio.Task] = None
INTERVAL_SECONDS = 5  # Post toutes les 5 secondes (mode debug)

# Tâche d'automatisation préventive (backend-only, fonctionne même sans page ouverte)
automation_task: Optional[asyncio.Task] = None
AUTOMATION_INTERVAL_SECONDS = 20

# Prédicteur ML (initialisé paresseusement)
ml_predictor = None

# Cache des prédictions ML pour éviter les appels répétés (TTL = 30s)
_prediction_cache: dict = {}
PREDICTION_CACHE_TTL = 30  # secondes


def get_ml_predictor():
    """Initialise le prédicteur ML une seule fois"""
    global ml_predictor
    if ml_predictor is None:
        try:
            from .ml.ml_predict_generic import RealtimeGenericPredictor
            ml_predictor = RealtimeGenericPredictor(model_dir=settings.ML_MODELS_DIR)
            logger.info("✅ ML Predictor initialized")
        except Exception as e:
            logger.error(f"❌ Failed to load ML predictor: {e}")
            ml_predictor = False
    return ml_predictor if ml_predictor is not False else None


# ============================================================================
# ENDPOINTS ML PREDICTION
# ============================================================================

@app.get("/api/predict/score")
def get_predicted_score(
    enseigne: Optional[str] = None,
    salle: Optional[str] = None,
    sensor_id: Optional[str] = None
):
    """
    Retourne le score IAQ prédit dans 30 minutes par le modèle ML.
    Si le modèle n'est pas disponible, utilise un fallback basé sur les tendances.
    """
    try:
        predictor = get_ml_predictor()
        
        # Essayer d'abord avec le modèle ML
        if predictor:
            if not enseigne:
                enseigne = "Maison"
            
            prediction_result = predictor.predict(
                enseigne=enseigne,
                salle=salle,
                sensor_id=sensor_id
            )
            
            if "error" not in prediction_result:
                predicted_values = prediction_result.get("predicted_values", {})
                
                if predicted_values:
                    from .iaq_score import calculate_iaq_score
                    score_data = calculate_iaq_score(predicted_values)
                    
                    return {
                        "predicted_score": score_data["global_score"],
                        "predicted_level": score_data["global_level"],
                        "forecast_minutes": prediction_result.get("forecast_minutes", 30),
                        "predictions": predicted_values,
                        "enseigne": prediction_result.get("enseigne"),
                        "salle": prediction_result.get("salle"),
                        "sensor_id": prediction_result.get("sensor_id"),
                        "timestamp": prediction_result.get("timestamp"),
                        "is_ml_prediction": True
                    }
        
        # Fallback: calcul simple basé sur les tendances
        logger.info("Using fallback prediction based on trends")
        return _calculate_fallback_prediction(enseigne, salle)
            
    except Exception as e:
        logger.error(f"Error in predict score endpoint: {e}")
        return _calculate_fallback_prediction(enseigne, salle)


def _calculate_fallback_prediction(enseigne: Optional[str], salle: Optional[str]):
    """Calcule une prédiction simple basée sur les tendances récentes"""
    try:
        from .iaq_score import calculate_iaq_score
        from .api.query import get_iaq_data
        
        # Utiliser l'API pour obtenir les données récentes
        data_response = get_iaq_data(
            enseigne=enseigne,
            salle=salle,
            hours=1,
            raw=False
        )
        
        # La réponse peut être une liste directement ou un dict avec une clé Data
        if isinstance(data_response, dict) and "Data" in data_response:
            recent_data = data_response["Data"]
        elif isinstance(data_response, list):
            recent_data = data_response
        else:
            recent_data = []
        
        if len(recent_data) < 3:
            return {
                "error": "Insufficient data for prediction",
                "predicted_score": None,
                "predicted_level": None,
                "is_ml_prediction": False
            }
        
        # Prendre les 10 dernières valeurs avec un global_score
        scored_data = [d for d in recent_data if "global_score" in d and d["global_score"] is not None]
        scored_data = scored_data[-10:]
        
        if len(scored_data) < 2:
            return {
                "error": "Insufficient scored data",
                "predicted_score": None,
                "predicted_level": None,
                "is_ml_prediction": False
            }
        
        # Extraire les scores
        scores = [d["global_score"] for d in scored_data]
        current_score = scores[-1]
        
        # Calculer la tendance
        if len(scores) >= 3:
            # Diviser en deux moitiés pour voir la tendance
            half = len(scores) // 2
            first_half_avg = sum(scores[:half]) / half
            second_half_avg = sum(scores[half:]) / (len(scores) - half)
            trend = second_half_avg - first_half_avg
        else:
            trend = scores[-1] - scores[0]
        
        # Prédiction = score actuel + tendance (limité entre 0 et 100)
        predicted_score = max(0, min(100, current_score + trend))
        
        # Déterminer le niveau
        if predicted_score >= 90:
            predicted_level = "excellent"
        elif predicted_score >= 70:
            predicted_level = "good"
        elif predicted_score >= 50:
            predicted_level = "moderate"
        else:
            predicted_level = "poor"
        
        logger.info(f"Fallback prediction: current={current_score}, trend={trend:.2f}, predicted={predicted_score:.1f}")
        
        return {
            "predicted_score": round(predicted_score, 1),
            "predicted_level": predicted_level,
            "forecast_minutes": 30,
            "current_score": current_score,
            "trend": round(trend, 2),
            "enseigne": enseigne,
            "salle": salle,
            "is_ml_prediction": False,
            "method": "trend_based_fallback"
        }
        
    except Exception as e:
        logger.error(f"Error in fallback prediction: {e}")
        return {
            "error": f"Fallback prediction failed: {str(e)}",
            "predicted_score": None,
            "predicted_level": None,
            "is_ml_prediction": False
        }


@app.get("/api/predict/preventive-actions")
async def get_preventive_actions(
    enseigne: Optional[str] = None,
    salle: Optional[str] = None,
    sensor_id: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Analyse les prédictions ML et retourne les actions préventives à prendre.
    L'inférence LSTM est exécutée dans un thread executor pour ne pas bloquer l'event loop.
    Inclut un cache TTL de 30s par (enseigne, salle) pour éviter les appels répétés.
    """
    import time
    try:
        predictor = get_ml_predictor()

        if not enseigne:
            enseigne = "Maison"

        if not predictor:
            logger.error("ML predictor not available")
            return {
                "actions": [],
                "error": "ML predictor not available",
                "timestamp": datetime.now().isoformat()
            }

        try:
            cache_key = f"{enseigne}|{salle}|{sensor_id}"
            now = time.monotonic()

            # --- Lecture du cache (évite les appels ML répétés dans le TTL) ---
            cached = _prediction_cache.get(cache_key)
            if cached and (now - cached["ts"]) < PREDICTION_CACHE_TTL:
                prediction_result = cached["data"]
                logger.debug(f"Cache HIT preventive-actions pour {cache_key}")
            else:
                # --- Appel ML dans un thread executor (non-bloquant pour l'event loop) ---
                loop = asyncio.get_event_loop()
                prediction_result = await loop.run_in_executor(
                    None,
                    lambda: predictor.predict(
                        enseigne=enseigne,
                        salle=salle,
                        sensor_id=sensor_id
                    )
                )
                _prediction_cache[cache_key] = {"data": prediction_result, "ts": now}
                logger.debug(f"Cache MISS preventive-actions pour {cache_key}")

            if "error" in prediction_result:
                logger.error(f"ML prediction error: {prediction_result['error']}")
                return {
                    "actions": [],
                    "error": prediction_result["error"],
                    "timestamp": datetime.now().isoformat()
                }

            # Extraire les données de prédiction
            current_values = prediction_result.get("current_values", {})
            predicted_values = prediction_result.get("predicted_values", {})
            risk_analysis = prediction_result.get("risk_analysis", {})

            # Générer les actions depuis l'analyse de risque ML
            actions = _generate_actions_from_ml_risk_analysis(
                current_values=current_values,
                predicted_values=predicted_values,
                risk_analysis=risk_analysis,
                forecast_minutes=prediction_result.get("forecast_minutes", 30)
            )

            auto_apply_result = await _auto_apply_iot_actions(
                enseigne=enseigne,
                salle=salle,
                actions=actions,
                authorization=authorization,
            )

            logger.info(f"ML prediction generated {len(actions)} actions for {enseigne}/{salle}")

            # Calcul du score IAQ si manquant
            predicted_score = prediction_result.get("predicted_score")
            predicted_level = None
            if predicted_score is None and predicted_values:
                try:
                    from .iaq_score import calculate_iaq_score
                    score_data = calculate_iaq_score(predicted_values)
                    predicted_score = score_data["global_score"]
                    predicted_level = score_data["global_level"]
                except ImportError:
                    pass

            return {
                "timestamp": datetime.now().isoformat(),
                "status": {
                    "overall_risk": risk_analysis.get("overall_status", "unknown"),
                    "predicted_score": predicted_score,
                    "predicted_level": predicted_level
                },
                "forecast": {
                    "minutes": prediction_result.get("forecast_minutes", 30),
                    "model_used": "LSTM" if prediction_result.get("model") == "LSTM" else "Generic"
                },
                "metrics": risk_analysis.get("metrics", {}),
                "actions": actions,
                "auto_execution": auto_apply_result,
            }

        except Exception as e:
            logger.error(f"ML prediction failed: {e}")
            return {
                "actions": [],
                "error": f"ML prediction failed: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }


        
    except Exception as e:
        logger.error(f"Error in preventive actions endpoint: {e}")
        return {"actions": [], "error": str(e)}


def _normalize_token(value: Optional[str]) -> str:
    if not value:
        return ""
    text = str(value).strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("-", "_").replace(" ", "_")
    text = re.sub(r"[^a-z0-9_]", "", text)
    return text


def _device_module_candidates(device: str) -> List[str]:
    mapping = {
        "window": ["window", "fenetre", "fenêtre"],
        "door": ["door", "porte"],
        "ventilation": ["ventilation", "hvac", "clim", "climatisation", "air_conditioner", "ac"],
        "air_purifier": ["air_purifier", "purifier", "purificateur"],
        "radiator": ["radiator", "radiateur", "heater", "chauffage"],
    }
    return mapping.get(_normalize_token(device), [_normalize_token(device)])


def _desired_state_from_action(action_name: Optional[str]) -> Optional[str]:
    action = _normalize_token(action_name)
    desired_state_map = {
        "open": "open",
        "close": "closed",
        "turn_on": "on",
        "turn_off": "off",
        "increase": "on",
        "decrease": "off",
    }
    return desired_state_map.get(action)


def _panel_default_target_state_for_module(module_type: Optional[str]) -> Optional[str]:
    normalized_type = _normalize_token(module_type)
    if normalized_type in {"window", "fenetre", "door", "porte"}:
        return "closed"
    if normalized_type in {
        "ventilation",
        "hvac",
        "clim",
        "climatisation",
        "air_conditioning",
        "air_conditioner",
        "ac",
        "air_purifier",
        "purifier",
        "purificateur",
    }:
        return "on"
    if normalized_type in {"radiator", "radiateur", "heater", "chauffage"}:
        return "off"
    return None


def _matches_module(module: Dict[str, Any], candidates: List[str]) -> bool:
    values = [
        _normalize_token(module.get("id")),
        _normalize_token(module.get("type")),
        _normalize_token(module.get("name")),
    ]

    for value in values:
        if not value:
            continue
        for candidate in candidates:
            if not candidate:
                continue
            if value == candidate or value.startswith(f"{candidate}_") or candidate in value:
                return True
    return False


def _token_matches(query: Optional[str], *values: Optional[str]) -> bool:
    normalized_query = _normalize_token(query)
    if not normalized_query:
        return True

    for value in values:
        normalized_value = _normalize_token(value)
        if not normalized_value:
            continue
        if (
            normalized_query == normalized_value
            or normalized_query in normalized_value
            or normalized_value in normalized_query
        ):
            return True

    return False


def _find_room_modules(config: Dict[str, Any], enseigne: Optional[str], salle: Optional[str]):
    lieux = (config or {}).get("lieux", {})
    enseignes = lieux.get("enseignes", []) if isinstance(lieux, dict) else []

    for ens in enseignes:
        ens_id = (ens or {}).get("id")
        ens_nom = (ens or {}).get("nom")
        if not _token_matches(enseigne, ens_id, ens_nom):
            continue

        for piece in (ens or {}).get("pieces", []) or []:
            piece_id = (piece or {}).get("id")
            piece_nom = (piece or {}).get("nom")
            if not _token_matches(salle, piece_id, piece_nom):
                continue

            modules = piece.get("modules", [])
            return {
                "enseigne_id": (ens or {}).get("id") or (ens or {}).get("nom"),
                "piece_id": (piece or {}).get("id") or (piece or {}).get("nom"),
                "modules": modules if isinstance(modules, list) else [],
            }

    return None


async def _auto_apply_iot_actions(
    enseigne: Optional[str],
    salle: Optional[str],
    actions: List[Dict[str, Any]],
    authorization: Optional[str],
) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "enabled": True,
        "considered": len(actions or []),
        "applied": 0,
        "skipped": 0,
        "saved": False,
    }

    if not actions:
        return summary

    if not authorization:
        summary["enabled"] = False
        summary["reason"] = "missing_authorization"
        return summary

    if not supabase:
        summary["enabled"] = False
        summary["reason"] = "supabase_unavailable"
        return summary

    try:
        user = await get_current_user(credentials=None, authorization=authorization)
        user_id = user.get("id")
    except Exception as e:
        logger.debug(f"Auto-apply IoT skipped (auth error): {e}")
        summary["enabled"] = False
        summary["reason"] = "auth_failed"
        return summary

    if not user_id:
        summary["enabled"] = False
        summary["reason"] = "missing_user_id"
        return summary

    return await _auto_apply_iot_actions_for_user(user_id, enseigne, salle, actions)


async def _auto_apply_iot_actions_for_user(
    user_id: str,
    enseigne: Optional[str],
    salle: Optional[str],
    actions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "enabled": True,
        "considered": len(actions or []),
        "applied": 0,
        "skipped": 0,
        "saved": False,
        "panel_corrections": 0,
    }

    if not actions:
        return summary

    if not user_id:
        summary["enabled"] = False
        summary["reason"] = "missing_user_id"
        return summary

    config = load_user_config(user_id)
    if not config:
        summary["enabled"] = False
        summary["reason"] = "config_not_found"
        return summary

    room_context = _find_room_modules(config, enseigne, salle)
    if not room_context or not room_context.get("modules"):
        summary["enabled"] = False
        summary["reason"] = "room_or_modules_not_found"
        return summary

    modules = room_context.get("modules", [])
    enseigne_id = room_context.get("enseigne_id")
    piece_id = room_context.get("piece_id")

    has_changed = False
    changed_modules: List[Dict[str, Any]] = []
    preventive_candidate_groups: List[List[str]] = []

    for action in actions:
        candidates = _device_module_candidates(action.get("device", ""))
        preventive_candidate_groups.append(candidates)
        desired_state = _desired_state_from_action(action.get("action"))
        if not desired_state:
            action["auto_executed"] = False
            action["auto_skip_reason"] = "unsupported_action"
            summary["skipped"] += 1
            continue

        matched_modules = []
        for module in modules:
            if not isinstance(module, dict):
                continue
            if not module.get("is_iot", False):
                continue
            if _matches_module(module, candidates):
                matched_modules.append(module)

        if not matched_modules:
            action["auto_executed"] = False
            action["auto_skip_reason"] = "no_matching_iot_module"
            summary["skipped"] += 1
            continue

        matched_ids = []
        for target_module in matched_modules:
            current_state = _normalize_token(target_module.get("state"))
            if current_state != desired_state:
                target_module["state"] = desired_state
                has_changed = True
                changed_modules.append({
                    "module_id": target_module.get("id"),
                    "module_type": target_module.get("type") or action.get("device"),
                    "state": desired_state,
                })
            matched_ids.append(target_module.get("id"))

        action["auto_executed"] = True
        action["auto_module_ids"] = matched_ids
        action["auto_matched_count"] = len(matched_ids)
        if matched_ids:
            action["auto_module_id"] = matched_ids[0]
        summary["applied"] += 1

    panel_corrections = 0
    for module in modules:
        if not isinstance(module, dict):
            continue
        if not module.get("is_iot", False):
            continue

        if any(_matches_module(module, candidates) for candidates in preventive_candidate_groups):
            continue

        current_state = _normalize_token(module.get("state"))
        target_state = _panel_default_target_state_for_module(module.get("type"))
        if not target_state or current_state == target_state:
            continue

        module["state"] = target_state
        has_changed = True
        panel_corrections += 1
        changed_modules.append(
            {
                "module_id": module.get("id"),
                "module_type": module.get("type"),
                "state": target_state,
            }
        )

    summary["panel_corrections"] = panel_corrections

    if has_changed:
        summary["saved"] = bool(save_user_config(user_id, config))
        if summary["saved"]:
            try:
                ws_manager = get_websocket_manager()
                for changed in changed_modules:
                    await ws_manager.broadcast(
                        {
                            "type": "module_update",
                            "enseigne_id": enseigne_id,
                            "piece_id": piece_id,
                            "module_id": changed.get("module_id"),
                            "module_type": changed.get("module_type"),
                            "state": changed.get("state"),
                        },
                        topic="modules",
                    )

                await ws_manager.broadcast(
                    {
                        "type": "config_updated",
                        "config": config,
                        "user_id": user_id,
                    },
                    topic="all",
                )
            except Exception as ws_err:
                logger.warning(f"Auto-apply WS broadcast failed: {ws_err}")

    return summary


def _list_user_rooms_for_automation() -> List[Dict[str, str]]:
    if not supabase:
        return []

    try:
        response = supabase.table("user_configs").select("user_id, lieux").execute()
        rows = response.data or []
        jobs: List[Dict[str, str]] = []

        for row in rows:
            user_id = row.get("user_id")
            lieux = row.get("lieux") or {}
            enseignes = lieux.get("enseignes", []) if isinstance(lieux, dict) else []

            if not user_id or not isinstance(enseignes, list):
                continue

            for ens in enseignes:
                ens_name = (ens or {}).get("nom") or (ens or {}).get("id")
                for piece in ((ens or {}).get("pieces") or []):
                    piece_name = (piece or {}).get("nom") or (piece or {}).get("id")
                    modules = (piece or {}).get("modules") or []
                    has_iot_module = any(
                        isinstance(module, dict) and module.get("is_iot", False)
                        for module in modules
                    )
                    if not has_iot_module:
                        continue
                    if ens_name and piece_name:
                        jobs.append(
                            {
                                "user_id": user_id,
                                "enseigne": str(ens_name),
                                "salle": str(piece_name),
                            }
                        )

        return jobs
    except Exception as e:
        logger.error(f"Automation: unable to list user rooms: {e}")
        return []


async def _run_preventive_automation_cycle() -> None:
    predictor = get_ml_predictor()
    if not predictor:
        logger.debug("Automation: predictor unavailable, cycle skipped")
        return

    jobs = _list_user_rooms_for_automation()
    if not jobs:
        logger.debug("Automation: no user rooms found")
        return

    loop = asyncio.get_event_loop()
    applied_total = 0

    for job in jobs:
        enseigne = job["enseigne"]
        salle = job["salle"]
        user_id = job["user_id"]

        try:
            prediction_result = await loop.run_in_executor(
                None,
                lambda e=enseigne, s=salle: predictor.predict(
                    enseigne=e,
                    salle=s,
                    sensor_id=None,
                ),
            )
            if not prediction_result or "error" in prediction_result:
                continue

            actions = _generate_actions_from_ml_risk_analysis(
                current_values=prediction_result.get("current_values", {}),
                predicted_values=prediction_result.get("predicted_values", {}),
                risk_analysis=prediction_result.get("risk_analysis", {}),
                forecast_minutes=prediction_result.get("forecast_minutes", 30),
            )
            if not actions:
                continue

            result = await _auto_apply_iot_actions_for_user(
                user_id=user_id,
                enseigne=enseigne,
                salle=salle,
                actions=actions,
            )
            applied_total += int(result.get("applied") or 0)
        except Exception as room_err:
            logger.debug(
                f"Automation: room cycle failed user={user_id} enseigne={enseigne} salle={salle}: {room_err}"
            )

    logger.info(
        f"Automation cycle done: rooms={len(jobs)}, applied_actions={applied_total}"
    )


async def run_preventive_automation_loop(interval: int = AUTOMATION_INTERVAL_SECONDS):
    try:
        while True:
            try:
                await _run_preventive_automation_cycle()
            except Exception as cycle_err:
                logger.error(f"Automation cycle error: {cycle_err}")

            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                logger.info("Automation loop cancelled during sleep")
                raise
    except asyncio.CancelledError:
        logger.info("Automation loop cancelled")
        raise


def _generate_actions_from_ml_risk_analysis(
    current_values: dict,
    predicted_values: dict,
    risk_analysis: dict,
    forecast_minutes: int = 30,
) -> list:
    """
    Génère des actions préventives à partir de l'analyse de risque ML.
    Transforme les actions du ML (format technique) en format frontend (avec valeurs prédites).
    """
    device_mapping = _get_ml_device_mapping()
    actions_needed = risk_analysis.get("actions_needed", [])
    metrics = risk_analysis.get("metrics", {})

    actions: list = []
    for action_item in actions_needed:
        metric = action_item.get("metric")
        metric_data = metrics.get(metric, {})

        # Cas particuliers
        if metric == "temperature":
            device_entries = _get_temperature_devices(metric_data)
        elif metric == "humidity":
            device_entries = _get_humidity_devices(metric_data)
        elif metric in device_mapping:
            device_entries = device_mapping[metric]
            if isinstance(device_entries, dict):
                device_entries = [device_entries]
        else:
            continue

        if not device_entries:
            continue

        actions.extend(
            _build_actions_for_metric(
                metric_data=metric_data,
                device_entries=device_entries,
                action_label=action_item.get("action", "Action recommandée"),
                forecast_minutes=forecast_minutes,
            )
        )

    priority_order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    actions.sort(key=lambda x: priority_order.get(x.get("priority", "low"), 99))
    return actions


def _get_ml_device_mapping() -> dict:
    """Mapping des métriques ML vers les dispositifs frontend."""
    return {
        "co2": [
            {
                "device": "window",
                "action": "open",
                "parameter": "CO₂",
                "unit": "ppm",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
            {
                "device": "door",
                "action": "open",
                "parameter": "CO₂",
                "unit": "ppm",
                "priority_map": {"warning": "low", "critical": "medium", "danger": "high"},
            },
        ],
        "pm25": [
            {
                "device": "air_purifier",
                "action": "turn_on",
                "parameter": "PM2.5",
                "unit": "µg/m³",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
            {
                "device": "window",
                "action": "open",
                "parameter": "PM2.5",
                "unit": "µg/m³",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
        ],
        "tvoc": [
            {
                "device": "air_purifier",
                "action": "turn_on",
                "parameter": "TVOC",
                "unit": "ppb",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
            {
                "device": "ventilation",
                "action": "increase",
                "parameter": "TVOC",
                "unit": "ppb",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
        ],
    }


def _get_temperature_devices(metric_data: dict) -> list:
    """Détermine les dispositifs à utiliser pour la température."""
    current_val = metric_data.get("current_value", 0)
    predicted_val = metric_data.get("predicted_value", 0)
    predicted_level = metric_data.get("predicted_level", "good")

    if predicted_val > 25 or (current_val > 25 and predicted_level != "good"):
        return [
            {
                "device": "ventilation",  # Clim
                "action": "increase",
                "parameter": "Température",
                "unit": "°C",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
            {
                "device": "window",
                "action": "open",
                "parameter": "Température",
                "unit": "°C",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            },
        ]

    if predicted_val < 19 or (current_val < 19 and predicted_level != "good"):
        return [
            {
                "device": "radiator",
                "action": "increase",
                "parameter": "Température",
                "unit": "°C",
                "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
            }
        ]

    return []


def _get_humidity_devices(metric_data: dict) -> list:
    """Détermine les dispositifs à utiliser pour l'humidité."""
    predicted_val = metric_data.get("predicted_value", 0)
    if predicted_val <= 65:
        return []

    return [
        {
            "device": "ventilation",
            "action": "increase",
            "parameter": "Humidité",
            "unit": "%",
            "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
        },
        {
            "device": "window",  # Aérer pour chasser l'humidité
            "action": "open",
            "parameter": "Humidité",
            "unit": "%",
            "priority_map": {"warning": "medium", "critical": "high", "danger": "urgent"},
        },
    ]


def _build_actions_for_metric(
    metric_data: dict,
    device_entries: list,
    action_label: str,
    forecast_minutes: int,
) -> list:
    """Construit la liste d'actions pour une métrique donnée."""
    actions = []
    current_val = metric_data.get("current_value", 0)
    predicted_val = metric_data.get("predicted_value", 0)
    current_level = metric_data.get("current_level", "good")
    predicted_level = metric_data.get("predicted_level", "good")

    for device_info in device_entries:
        priority_map = device_info.get("priority_map", {})
        if current_level in ["critical", "danger"]:
            priority = "urgent"
        elif predicted_level in ["critical", "danger"]:
            priority = priority_map.get(predicted_level, "high")
        else:
            priority = priority_map.get(current_level, "medium")

        actions.append(
            {
                "device": device_info["device"],
                "action": device_info["action"],
                "parameter": device_info["parameter"],
                "current_value": round(current_val, 1),
                "predicted_value": round(predicted_val, 1),
                "unit": device_info["unit"],
                "priority": priority,
                "level": current_level if current_level in ["critical", "danger"] else predicted_level,
                "trend": metric_data.get("trend", "stable"),
                "change_percent": metric_data.get("change_percent", 0),
                "reason": action_label,
                "forecast_minutes": forecast_minutes,
                "is_ml_action": True,
            }
        )
    return actions

def _generate_actions_from_current_data(enseigne: str, salle: Optional[str], sensor_id: Optional[str]):
    """
    Génère des actions préventives basées uniquement sur les données actuelles et les seuils.
    """
    try:
        current_data = _find_current_data(enseigne, salle, sensor_id)

        if not current_data:
            return {"actions": [], "error": "No current data available", "is_fallback": True}

        thresholds = {
            "co2": {"warning": 600, "danger": 900},
            "pm25": {"warning": 10, "danger": 25},
            "tvoc": {"warning": 200, "danger": 600},
            "temperature": {"cold": 18, "hot": 24},
            "humidity": {"dry": 30, "humid": 70},
        }

        actions = []
        actions.extend(_evaluate_co2_actions(current_data, thresholds))
        actions.extend(_evaluate_pm25_actions(current_data, thresholds))
        actions.extend(_evaluate_tvoc_actions(current_data, thresholds))
        actions.extend(_evaluate_temperature_actions(current_data, thresholds))
        actions.extend(_evaluate_humidity_actions(current_data, thresholds))
        actions.extend(_evaluate_multi_param_actions(current_data, thresholds))

        priority_order = {"high": 0, "medium": 1, "low": 2}
        actions.sort(key=lambda x: priority_order.get(x.get("priority", "low"), 99))

        logger.info(f"Generated {len(actions)} fallback actions for {enseigne}/{salle}")

        return {
            "actions": actions,
            "forecast_minutes": 0,
            "timestamp": datetime.now().isoformat(),
            "is_fallback": True,
            "method": "threshold_based_fallback",
        }

    except Exception as e:
        logger.error(f"Error generating fallback actions: {e}")
        return {"actions": [], "error": str(e), "is_fallback": True}


def _find_current_data(enseigne: str, salle: Optional[str], sensor_id: Optional[str]):
    """Retrouve la dernière mesure correspondant aux filtres donnés."""
    try:
        from .api.query import get_iaq_data
        
        # Récupérer les données récentes (dernière heure)
        data_response = get_iaq_data(
            enseigne=enseigne,
            salle=salle,
            hours=1,
            raw=False
        )
        
        # Extraire les données de la réponse
        if isinstance(data_response, dict) and "Data" in data_response:
            recent_data = data_response["Data"]
        elif isinstance(data_response, list):
            recent_data = data_response
        else:
            recent_data = []
        
        # Filtrer et trouver la dernière mesure
        filtered_data = []
        for item in recent_data:
            if not isinstance(item, dict):
                continue
            if item.get("enseigne") != enseigne:
                continue
            if salle is not None and item.get("salle") != salle:
                continue
            if sensor_id is not None and item.get("sensor_id") != sensor_id:
                continue
            filtered_data.append(item)
        
        # Retourner la dernière mesure si disponible
        return filtered_data[-1] if filtered_data else None
        
    except Exception as e:
        logger.debug(f"Error finding current data: {e}")
        return None


def _evaluate_co2_actions(current_data: dict, thresholds: dict) -> list:
    actions = []
    current_co2 = float(current_data.get("co2", 0))
    if current_co2 < thresholds["co2"]["warning"]:
        return actions

    priority = "high" if current_co2 >= thresholds["co2"]["danger"] else "medium"
    actions.append(
        {
            "device": "window",
            "action": "open",
            "parameter": "CO₂",
            "current_value": round(current_co2, 1),
            "threshold": thresholds["co2"]["warning"],
            "unit": "ppm",
            "priority": priority,
            "reason": f"Le CO₂ actuel ({current_co2:.0f} ppm) dépasse le seuil recommandé",
        },
        {
            "device": "door",
            "action": "open",
            "parameter": "CO₂",
            "current_value": round(current_co2, 1),
            "threshold": thresholds["co2"]["warning"],
            "unit": "ppm",
            "priority": "low" if priority == "medium" else "medium",
            "reason": "Ouvrir la porte aide à ventiler le CO₂",
        }
    )
    return actions


def _evaluate_pm25_actions(current_data: dict, thresholds: dict) -> list:
    actions = []
    current_pm = float(current_data.get("pm25", 0))
    if current_pm < thresholds["pm25"]["warning"]:
        return actions

    priority = "high" if current_pm >= thresholds["pm25"]["danger"] else "medium"
    actions.append(
        {
            "device": "air_purifier",
            "action": "turn_on",
            "parameter": "PM2.5",
            "current_value": round(current_pm, 1),
            "threshold": thresholds["pm25"]["warning"],
            "unit": "µg/m³",
            "priority": priority,
            "reason": f"Les particules fines ({current_pm:.1f} µg/m³) dépassent le seuil recommandé",
        },
        {
            "device": "window",
            "action": "open",
            "parameter": "PM2.5",
            "current_value": round(current_pm, 1),
            "threshold": thresholds["pm25"]["warning"],
            "unit": "µg/m³",
            "priority": priority,
            "reason": f"Aération recommandée pour évacuer les particules fines ({current_pm:.1f} µg/m³)",
        }
    )
    return actions


def _evaluate_tvoc_actions(current_data: dict, thresholds: dict) -> list:
    actions = []
    current_tvoc = float(current_data.get("tvoc", 0))
    if current_tvoc < thresholds["tvoc"]["warning"]:
        return actions

    priority = "high" if current_tvoc >= thresholds["tvoc"]["danger"] else "medium"
    actions.append(
        {
            "device": "ventilation",
            "action": "increase",
            "parameter": "TVOC",
            "current_value": round(current_tvoc, 1),
            "threshold": thresholds["tvoc"]["warning"],
            "unit": "ppb",
            "priority": priority,
            "reason": f"Les COV ({current_tvoc:.0f} ppb) nécessitent une ventilation accrue",
        },
        {
            "device": "air_purifier",
            "action": "turn_on",
            "parameter": "TVOC",
            "current_value": round(current_tvoc, 1),
            "threshold": thresholds["tvoc"]["warning"],
            "unit": "ppb",
            "priority": priority,
            "reason": f"Traitement complémentaire des polluants chimiques ({current_tvoc:.0f} ppb)",
        }
    )
    return actions


def _evaluate_temperature_actions(current_data: dict, thresholds: dict) -> list:
    actions = []
    current_temp = float(current_data.get("temperature", 20))
    if current_temp < thresholds["temperature"]["cold"]:
        actions.append(
            {
                "device": "radiator",
                "action": "increase",
                "parameter": "Température",
                "current_value": round(current_temp, 1),
                "threshold": thresholds["temperature"]["cold"],
                "unit": "°C",
                "priority": "medium",
                "reason": f"La température ({current_temp:.1f}°C) est trop basse",
            }
        )
    elif current_temp > thresholds["temperature"]["hot"]:
        actions.append(
            {
                "device": "window",
                "action": "open",
                "parameter": "Température",
                "current_value": round(current_temp, 1),
                "threshold": thresholds["temperature"]["hot"],
                "unit": "°C",
                "priority": "medium",
                "reason": f"La température ({current_temp:.1f}°C) est trop élevée",
            }
        )
    return actions


def _evaluate_humidity_actions(current_data: dict, thresholds: dict) -> list:
    actions = []
    current_hum = float(current_data.get("humidity", 50))
    if current_hum < thresholds["humidity"]["dry"]:
        actions.append(
            {
                "device": "window",
                "action": "close",
                "parameter": "Humidité",
                "current_value": round(current_hum, 1),
                "threshold": thresholds["humidity"]["dry"],
                "unit": "%",
                "priority": "low",
                "reason": f"L'humidité ({current_hum:.1f}%) est trop basse",
            }
        )
    elif current_hum > thresholds["humidity"]["humid"]:
        actions.append(
            {
                "device": "ventilation",
                "action": "increase",
                "parameter": "Humidité",
                "current_value": round(current_hum, 1),
                "threshold": thresholds["humidity"]["humid"],
                "unit": "%",
                "priority": "low",
                "reason": f"L'humidité ({current_hum:.1f}%) est trop élevée",
            }
        )
    return actions


def _evaluate_multi_param_actions(current_data: dict, thresholds: dict) -> list:
    actions = []
    current_co2 = float(current_data.get("co2", 0))
    current_pm = float(current_data.get("pm25", 0))
    current_tvoc = float(current_data.get("tvoc", 0))

    bad_params_count = 0
    if current_co2 >= thresholds["co2"]["warning"]:
        bad_params_count += 1
    if current_pm >= thresholds["pm25"]["warning"]:
        bad_params_count += 1
    if current_tvoc >= thresholds["tvoc"]["warning"]:
        bad_params_count += 1

    if bad_params_count >= 2:
        actions.append(
            {
                "device": "door",
                "action": "open",
                "parameter": "Qualité de l'air",
                "current_value": bad_params_count,
                "threshold": 2,
                "unit": "paramètres",
                "priority": "high",
                "reason": "Plusieurs paramètres de qualité d'air sont dégradés (CO₂, PM2.5, TVOC)",
            }
        )
    return actions


# ============================================================================
# WEBSOCKET ENDPOINT
# ============================================================================
# ============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Endpoint WebSocket pour les communications en temps réel.
    Le client peut s'abonner à différents topics : measurements, predictions, actions, alerts, modules, all
    """
    ws_manager = get_websocket_manager()
    
    # Attendre la connexion et les topics
    await ws_manager.connect(websocket, topics=["all"])
    
    try:
        while True:
            # Attendre les messages du client
            data = await websocket.receive_json()
            
            # Gérer les commandes du client
            if data.get("type") == "subscribe":
                topics = data.get("topics", [])
                for topic in topics:
                    if topic in ws_manager.subscriptions:
                        ws_manager.subscriptions[topic].add(websocket)
                        logger.info(f"Client abonné au topic: {topic}")
            
            elif data.get("type") == "unsubscribe":
                topics = data.get("topics", [])
                for topic in topics:
                    if topic in ws_manager.subscriptions:
                        ws_manager.subscriptions[topic].discard(websocket)
                        logger.info(f"Client désabonné du topic: {topic}")
            
            elif data.get("type") == "ping":
                await ws_manager.send_personal_message({"type": "pong"}, websocket)
            
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
        logger.info("Client WebSocket déconnecté")
    except Exception as e:
        logger.error(f"Erreur WebSocket: {e}")
        ws_manager.disconnect(websocket)


@app.get("/ws/stats")
def get_websocket_stats():
    """Retourne les statistiques des connexions WebSocket"""
    ws_manager = get_websocket_manager()
    return ws_manager.get_stats()


# ============================================================================
# TÂCHE DE POSTING PÉRIODIQUE (SIMULATION)
# ============================================================================

async def add_iaq_record(payload: dict):
    """Ajoute un enregistrement dans iaq_database ET dans InfluxDB"""
    from .utils import sanitize_for_storage
    
    rec = sanitize_for_storage(payload)
    if "enseigne" not in rec or rec.get("enseigne") is None:
        rec["enseigne"] = "Maison"
    if "salle" not in rec or rec.get("salle") is None:
        rec["salle"] = "Bureau"
    if "sensor_id" not in rec or rec.get("sensor_id") is None:
        rec["sensor_id"] = "Bureau1"
    
    # Ensure timestamp is present and is UTC ISO with 'Z'
    if "timestamp" not in rec or not rec["timestamp"]:
        rec["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    # Écrire aussi dans InfluxDB
    if settings.INFLUXDB_ENABLED:
        try:
            influx = get_influx_client(
                url=settings.INFLUXDB_URL,
                token=settings.INFLUXDB_TOKEN,
                org=settings.INFLUXDB_ORG,
                bucket=settings.INFLUXDB_BUCKET
            )
            if influx and influx.available:
                # Préparer les données au format InfluxDB (minuscules pour compatibilité ML)
                influx_data = {
                    "sensor_id": rec.get("sensor_id", "Bureau1"),
                    "enseigne": rec["enseigne"],
                    "salle": rec["salle"],
                    "timestamp": rec["timestamp"],
                    "values": {
                        "co2": rec.get("co2", 0),
                        "pm25": rec.get("pm25", 0),
                        "tvoc": rec.get("tvoc", 0),
                        "temperature": rec.get("temperature", 0),
                        "humidity": rec.get("humidity", 0),
                        "occupants": rec.get("occupants", 0)
                    }
                }
                influx.write_measurement(influx_data)
        except Exception as e:
            logger.error(f"Erreur écriture InfluxDB: {e}")

    # Calculer le score IAQ pour le temps réel
    try:
        from .iaq_score import calculate_iaq_score
        score_inputs = {
            "co2": rec.get("co2", 0),
            "pm25": rec.get("pm25", 0),
            "tvoc": rec.get("tvoc", 0),
            "humidity": rec.get("humidity", 0)
        }
        # Nettoyer les inputs (None -> 0)
        clean_inputs = {k: (v if v is not None else 0) for k, v in score_inputs.items()}
        score_data = calculate_iaq_score(clean_inputs)
        rec["global_score"] = score_data["global_score"]
        rec["global_level"] = score_data["global_level"]
    except Exception as e:
        logger.warning(f"Erreur calcul score temps réel: {e}")
    
    # S'assurer que occupants est présent dans rec (par défaut 0 si absent)
    if "occupants" not in rec or rec["occupants"] is None:
        rec["occupants"] = 0

    # Diffusion WebSocket
    if settings.WEBSOCKET_ENABLED:
        try:
            ws_manager = get_websocket_manager()
            await ws_manager.broadcast_measurement(rec)
        except Exception as e:
            logger.error(f"Erreur broadcast WebSocket: {e}")
    
    logger.info(f"Seeded IAQ record")
    return rec


async def post_rows_periodically(interval: int = INTERVAL_SECONDS, loop_forever: bool = True):
    """Poste les lignes du DATA_DF une par une toutes les `interval` secondes"""
    try:
        if DATA_DF is None or DATA_DF.empty:
            await add_iaq_record({
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "co2": 400,
                "pm25": 10,
                "tvoc": 0.5,
                "temperature": 21.0,
                "humidity": 40.0,
                "enseigne": "Maison",
                "salle": "Bureau",
                "sensor_id": "Bureau1",
            })
            logger.info("No DATA_DF found; posted a single test record")
            return

        rows = list(DATA_DF.to_dict(orient="records"))
        
        # Division du dataset en deux moitiés
        mid_point = len(rows) // 2
        rows_maison = rows[:mid_point]
        rows_boutique = rows[mid_point:]
        
        # Pré-traitement de la deuxième moitié pour la Boutique
        for row in rows_boutique:
            row['enseigne'] = "Boutique"
            row['salle'] = "Bureau"
            row['capteur_id'] = "Bureau1"
            
        logger.info(f"Dataset split: {len(rows_maison)} rows for Maison, {len(rows_boutique)} rows for Boutique")

        while True:
            # On itère sur la plus grande longueur
            max_len = max(len(rows_maison), len(rows_boutique))
            
            for i in range(max_len):
                # Envoi Maison (si disponible)
                if i < len(rows_maison):
                    row = rows_maison[i]
                    payload = {}
                    for k, v in row.items():
                        if k == "timestamp":
                            payload["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                        else:
                            if isinstance(v, (np.generic,)):
                                try:
                                    v = v.item()
                                except Exception:
                                    pass
                            payload[k] = None if pd.isna(v) else v
                    await add_iaq_record(payload)

                # Envoi Boutique (si disponible)
                if i < len(rows_boutique):
                    row = rows_boutique[i]
                    payload = {}
                    for k, v in row.items():
                        if k == "timestamp":
                            payload["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                        else:
                            if isinstance(v, (np.generic,)):
                                try:
                                    v = v.item()
                                except Exception:
                                    pass
                            payload[k] = None if pd.isna(v) else v
                    await add_iaq_record(payload)

                try:
                    await asyncio.sleep(interval)
                except asyncio.CancelledError:
                    logger.info("post_rows_periodically cancelled during sleep")
                    raise

            if not loop_forever:
                logger.info("Finished posting all rows once (loop_forever=False)")
                break

    except asyncio.CancelledError:
        logger.info("post_rows_periodically task cancelled")
        raise
    except Exception as e:
        logger.exception(f"Erreur dans la tâche périodique de posting: {e}")


# ============================================================================
# ÉVÉNEMENTS DE DÉMARRAGE ET ARRÊT
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialisation au démarrage de l'application"""
    global posting_task, automation_task
    
    logger.info("="*60)
    logger.info(f"🚀 Démarrage de {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info("="*60)
    
    # Initialiser InfluxDB si configuré
    if settings.INFLUXDB_ENABLED and settings.INFLUXDB_TOKEN:
        influx = get_influx_client(
            url=settings.INFLUXDB_URL,
            token=settings.INFLUXDB_TOKEN,
            org=settings.INFLUXDB_ORG,
            bucket=settings.INFLUXDB_BUCKET
        )
        if influx and influx.available:
            logger.info("✅ InfluxDB activé")
        else:
            logger.warning("⚠️  InfluxDB configuré mais non disponible")
    else:
        logger.info("ℹ️  InfluxDB désactivé - utilisation mémoire")
    
    # Initialiser WebSocket manager
    if settings.WEBSOCKET_ENABLED:
        ws_manager = get_websocket_manager()
        logger.info("✅ WebSocket manager initialisé")
    
    # Démarrer la tâche de simulation
    try:
        posting_task = asyncio.create_task(post_rows_periodically())
        logger.info(f"✅ Tâche de simulation démarrée (interval={INTERVAL_SECONDS}s)")
    except Exception as e:
        logger.exception(f"Erreur lors du démarrage de la tâche périodique: {e}")

    # Démarrer la tâche d'automatisation préventive backend (24/7)
    try:
        automation_task = asyncio.create_task(run_preventive_automation_loop())
        logger.info(
            f"✅ Tâche d'automatisation préventive démarrée (interval={AUTOMATION_INTERVAL_SECONDS}s)"
        )
    except Exception as e:
        logger.exception(f"Erreur lors du démarrage de la tâche d'automatisation: {e}")
    
    logger.info("="*60)


@app.on_event("shutdown")
async def shutdown_event():
    """Nettoyage à l'arrêt de l'application"""
    global posting_task, automation_task
    
    logger.info("🛑 Arrêt de l'application...")
    
    # Arrêter la tâche de simulation
    if posting_task is not None:
        try:
            posting_task.cancel()
            await posting_task
        except asyncio.CancelledError:
            logger.info("✅ Tâche de simulation arrêtée")
        except Exception as e:
            logger.exception(f"Erreur lors de l'arrêt de la tâche: {e}")

    if automation_task is not None:
        try:
            automation_task.cancel()
            await automation_task
        except asyncio.CancelledError:
            logger.info("✅ Tâche d'automatisation préventive arrêtée")
        except Exception as e:
            logger.exception(f"Erreur lors de l'arrêt de la tâche d'automatisation: {e}")
    
    # Fermer InfluxDB
    influx = get_influx_client()
    if influx:
        influx.close()
    
    logger.info("✅ Arrêt propre terminé")


# ============================================================================
# ENDPOINT ROOT
# ============================================================================

@app.get("/")
def root():
    """Endpoint racine avec informations sur l'API"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "features": {
            "influxdb": settings.INFLUXDB_ENABLED,
            "websocket": settings.WEBSOCKET_ENABLED,
            "mqtt": settings.MQTT_ENABLED
        },
        "endpoints": {
            "docs": "/docs",
            "websocket": "/ws",
            "ingest": "/api/ingest",
            "query": "/api/iaq/data",
            "config": "/config"
        }
    }


@app.get("/health")
def health_check():
    """Endpoint de santé pour monitoring"""
    influx = get_influx_client()
    
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "api": "up",
            "influxdb": "up" if (influx and influx.available) else "down",
            "websocket": "up" if settings.WEBSOCKET_ENABLED else "disabled",
            "mqtt": "up" if settings.MQTT_ENABLED else "disabled"
        },
        "data": {
            "status": "ok"
        }
    }
