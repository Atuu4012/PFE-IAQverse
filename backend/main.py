"""
API FastAPI pour le système IAQverse - Version 2.0
Architecture modulaire et microservices
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from typing import Optional, List
import asyncio
import logging
import pandas as pd
import numpy as np
from datetime import datetime, timezone

# Import des modules core
from .core import settings, get_influx_client, get_websocket_manager

# Import des routers API
from .api import (
    ingest_router,
    query_router,
    config_router
)

# Import des utilitaires
from .utils import load_dataset_df

# Configuration du logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn.error")

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

# Prédicteur ML (initialisé paresseusement)
ml_predictor = None


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
def get_preventive_actions(
    enseigne: Optional[str] = None,
    salle: Optional[str] = None,
    sensor_id: Optional[str] = None
):
    """
    Analyse les prédictions ML et retourne les actions préventives à prendre.
    Utilise le service ML pour prédire les valeurs futures et générer les actions.
    """
    try:
        predictor = get_ml_predictor()
        
        if not enseigne:
            enseigne = "Maison"
        
        # Si le modèle ML n'est pas disponible, retourner une erreur
        if not predictor:
            logger.error("ML predictor not available")
            return {
                "actions": [],
                "error": "ML predictor not available",
                "timestamp": datetime.now().isoformat()
            }
        
        try:
            # Faire la prédiction ML complète avec risk_analysis
            prediction_result = predictor.predict(
                enseigne=enseigne,
                salle=salle,
                sensor_id=sensor_id
            )
            
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
            
            logger.info(f"ML prediction generated {len(actions)} actions for {enseigne}/{salle}")
            
            # Calcul du score IAQ si manquant (pour avoir une réponse complète)
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

            # Structure simplifiée et claire pour le Frontend
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
                "metrics": risk_analysis.get("metrics", {}), # Contient Detail (Current vs Predicted + Trend)
                "actions": actions
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
    current_data = None
    if iaq_database:
        for item in reversed(iaq_database):
            if item.get("enseigne") != enseigne:
                continue
            if salle is not None and item.get("salle") != salle:
                continue
            if sensor_id is not None and item.get("sensor_id") != sensor_id:
                continue
            current_data = item
            break
    return current_data


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
    global posting_task
    
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
    
    logger.info("="*60)


@app.on_event("shutdown")
async def shutdown_event():
    """Nettoyage à l'arrêt de l'application"""
    global posting_task
    
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
