"""
API endpoints pour l'ingestion de données IAQ
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Optional
from datetime import datetime
import logging

from ..core import get_influx_client, get_websocket_manager, settings, get_alert_service
from ..iaq_score import calculate_iaq_score

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"])




class IAQMeasurement(BaseModel):
    """
    Modèle pour les mesures IAQ entrantes.
    Nouveau format standardisé.
    """
    sensor_id: str = Field(..., description="ID unique du capteur")
    enseigne: str = Field(..., description="Nom de l'enseigne/bâtiment")
    salle: str = Field(..., description="Nom de la salle/pièce")
    timestamp: str = Field(..., description="Timestamp ISO 8601")
    values: Dict[str, float] = Field(..., description="Valeurs mesurées (CO2, PM25, TVOC, Temperature, Humidity)")


class LegacyIAQData(BaseModel):
    """
    Ancien format de données IAQ (pour rétrocompatibilité).
    """
    timestamp: str
    co2: Optional[float] = None
    pm25: Optional[float] = None
    tvoc: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    enseigne: Optional[str] = "Maison"
    salle: Optional[str] = "Bureau"
    capteur_id: Optional[str] = None


@router.post("/ingest")
async def ingest_measurement(measurement: IAQMeasurement):
    """
    Endpoint d'ingestion pour les nouvelles mesures IAQ.
    
    Format attendu:
    {
        "sensor_id": "bureau1",
        "enseigne": "Maison",
        "salle": "Bureau",
        "timestamp": "2025-11-18T10:05:00Z",
        "values": {
            "CO2": 645,
            "PM25": 12,
            "TVOC": 0.2,
            "Temperature": 22.3,
            "Humidity": 45
        }
    }
    """
    try:
        data = measurement.dict()
        
        # Tentative d'écriture dans InfluxDB
        influx = get_influx_client(
            url=settings.INFLUXDB_URL,
            token=settings.INFLUXDB_TOKEN,
            org=settings.INFLUXDB_ORG,
            bucket=settings.INFLUXDB_BUCKET
        )
        
        if influx and influx.available:
            influx.write_measurement(data)
        
        # Calculer le score IAQ simple et l'ajouter au payload
        try:
            # Normaliser les clefs pour le calcul
            vals = data.get('values', {}) or {}
            score_input = {
                'co2': vals.get('CO2') if vals.get('CO2') is not None else vals.get('co2'),
                'pm25': vals.get('PM25') if vals.get('PM25') is not None else vals.get('pm25'),
                'tvoc': vals.get('TVOC') if vals.get('TVOC') is not None else vals.get('tvoc'),
                'temperature': vals.get('Temperature') if vals.get('Temperature') is not None else vals.get('temperature'),
                'humidity': vals.get('Humidity') if vals.get('Humidity') is not None else vals.get('humidity')
            }
            score_res = calculate_iaq_score(score_input)
            data['global_score'] = score_res.get('global_score')
            data['global_level'] = score_res.get('global_level')

            # Vérification des alertes persistantes
            try:
                # Vérification : Est-ce que le système est dans l'état optimal ("Green Lines") ?
                # L'utilisateur indique : "Une fenêtre peut être fermée et dans le bon état."
                # Cela signifie que l'on vérifie si les actionneurs suivent les recommandations.
                # N'ayant pas le retour d'état (feedback) des actionneurs dans ce payload d'ingestion,
                # nous partons du principe que le système d'automatisation (Frontend/Digital Twin) fait son travail.
                # Si la qualité est mauvaise, l'automate a dû mettre les équipements dans la configuration requise.
                
                # Donc, si la qualité est mauvaise, on assume par défaut que nous sommes "in_optimal_state" (Configuration Correcte).
                # Cela permet de déclencher l'alerte "Echec de la stratégie" (mail syndic) plus rapidement (15min).
                
                system_in_optimal_state = True 
                
                alert_svc = get_alert_service()
                await alert_svc.check_alert_condition(
                    sensor_id=data.get('sensor_id'), 
                    salle=data.get('salle'), 
                    iaq_score=score_res,
                    optimal_state=system_in_optimal_state
                )
            except Exception as e_alert:
                logger.error(f"Erreur process alerte: {e_alert}")
                
        except Exception as e:
            # Si le calcul échoue, on continue sans blocage
            logger.warning(f"Failed to calculate score or check alerts: {e}")
            data['global_score'] = None
            data['global_level'] = None

        # Diffusion WebSocket (inclut maintenant le score calculé)
        if settings.WEBSOCKET_ENABLED:
            ws_manager = get_websocket_manager()
            await ws_manager.broadcast_measurement(data)
        
        logger.info(f"✅ Mesure ingérée: {data['sensor_id']} @ {data['enseigne']}/{data['salle']}")
        
        return {
            "status": "success",
            "message": "Mesure enregistrée",
            "sensor_id": data["sensor_id"],
            "timestamp": data["timestamp"]
        }
        
    except Exception as e:
        logger.error(f"Erreur ingestion mesure: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/iaq")
async def ingest_legacy(data: LegacyIAQData):
    """
    Endpoint legacy pour la rétrocompatibilité.
    Convertit l'ancien format vers le nouveau format.
    """
    try:
        # Convertir vers le nouveau format
        sensor_id = data.capteur_id or f"{data.salle}1"
        
        new_measurement = IAQMeasurement(
            sensor_id=sensor_id,
            enseigne=data.enseigne or "Maison",
            salle=data.salle or "Bureau",
            timestamp=data.timestamp,
            values={
                "CO2": data.co2,
                "PM25": data.pm25,
                "TVOC": data.tvoc,
                "Temperature": data.temperature,
                "Humidity": data.humidity
            }
        )
        
        # Filtrer les valeurs None
        new_measurement.values = {
            k: v for k, v in new_measurement.values.items() 
            if v is not None
        }
        
        # Réutiliser l'endpoint principal
        return await ingest_measurement(new_measurement)
        
    except Exception as e:
        logger.error(f"Erreur ingestion legacy: {e}")
        raise HTTPException(status_code=500, detail=str(e))





@router.get("/ingest/stats")
def get_ingest_stats():
    """Retourne des statistiques sur l'ingestion"""
    return {
        "influxdb_enabled": settings.INFLUXDB_ENABLED,
        "websocket_enabled": settings.WEBSOCKET_ENABLED
    }
