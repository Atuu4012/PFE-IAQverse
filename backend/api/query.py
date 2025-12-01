"""
API endpoints pour interroger les données IAQ
"""
from fastapi import APIRouter, HTTPException
from typing import Optional
import pandas as pd
from datetime import datetime
import logging

from ..core import get_influx_client, settings
from ..utils import sanitize_for_storage
from ..iaq_score import calculate_iaq_score


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["query"])


@router.get("/iaq/data")
def get_iaq_data(
    enseigne: Optional[str] = None,
    salle: Optional[str] = None,
    sensor_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    hours: Optional[int] = None,
    step: Optional[str] = None,
    raw: bool = False
):
    """
    Endpoint unifié pour récupérer les données IAQ avec filtrage et agrégation flexibles.
    
    Paramètres de filtrage:
    - enseigne: Filtrer par enseigne
    - salle: Filtrer par salle
    - sensor_id: Filtrer par capteur
    
    Paramètres temporels:
    - start: Date de début (ISO format)
    - end: Date de fin (ISO format)
    - hours: Récupère les N dernières heures (si start/end absents)
    
    Paramètres d'agrégation:
    - step: Intervalle d'agrégation (5min, daily, weekly)
    - raw: Si True, retourne les données brutes sans agrégation
    """
    # Essayer d'abord InfluxDB
    influx = get_influx_client(
        url=settings.INFLUXDB_URL,
        token=settings.INFLUXDB_TOKEN,
        org=settings.INFLUXDB_ORG,
        bucket=settings.INFLUXDB_BUCKET
    )
    
    if influx and influx.available:
        try:
            # Déterminer la période
            if hours is not None and not start and not end:
                start_time = f"-{hours}h"
            else:
                start_time = start if start else "-24h"
            
            # Construire la requête Flux
            filters = []
            if enseigne:
                filters.append(f'r.enseigne == "{enseigne}"')
            if salle:
                filters.append(f'r.salle == "{salle}"')
            if sensor_id:
                filters.append(f'r.sensor_id == "{sensor_id}"')
            
            filter_clause = " and ".join(filters) if filters else "true"
            
            # Gestion de l'agrégation (step)
            aggregate_clause = ""
            if step and not raw:
                flux_step = "5m"  # Default fallback
                if step.lower() == "1min":
                    # Si on demande 1min, on renvoie les données brutes (pas d'agrégation)
                    # car l'utilisateur veut voir "les données reçues" (toutes les 5s)
                    aggregate_clause = ""
                elif step.lower() == "5min":
                    flux_step = "5m"
                    aggregate_clause = f'|> aggregateWindow(every: {flux_step}, fn: mean, createEmpty: false)'
                elif step.lower() == "daily":
                    flux_step = "1d"
                    aggregate_clause = f'|> aggregateWindow(every: {flux_step}, fn: mean, createEmpty: false)'
                elif step.lower() == "weekly":
                    flux_step = "1w"
                    aggregate_clause = f'|> aggregateWindow(every: {flux_step}, fn: mean, createEmpty: false)'
                else:
                    # Default case for other steps
                    aggregate_clause = f'|> aggregateWindow(every: {flux_step}, fn: mean, createEmpty: false)'
            
            flux_query = f'''
                from(bucket: "{settings.INFLUXDB_BUCKET}")
                    |> range(start: {start_time})
                    |> filter(fn: (r) => r._measurement == "iaq_raw")
                    |> filter(fn: (r) => {filter_clause})
                    {aggregate_clause}
                    |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
                    |> sort(columns: ["_time"])
            '''
            
            # logger.info(f"Flux Query: {flux_query}")
            influx_data = influx.query_data(flux_query)
            
            if influx_data:
                # Ajouter global_score pour chaque point
                for record in influx_data:
                    try:
                        predictions = {
                            "co2": record.get("co2"),
                            "pm25": record.get("pm25"),
                            "tvoc": record.get("tvoc"),
                            "humidity": record.get("humidity")
                        }
                        clean_predictions = {k: (v if v is not None else 0) for k, v in predictions.items()}
                        score_data = calculate_iaq_score(clean_predictions)
                        record["global_score"] = score_data["global_score"]
                        record["global_level"] = score_data["global_level"]
                    except Exception as e:
                        logger.warning(f"Erreur calcul score: {e}")
                        record["global_score"] = None
                        record["global_level"] = "unknown"
                
                logger.info(f"✅ Données récupérées depuis InfluxDB: {len(influx_data)} points (step={step})")
                return influx_data
            else:
                logger.info(f"⚠️ InfluxDB a retourné 0 points pour {enseigne}/{salle} (step={step})")
                
        except Exception as e:
            logger.warning(f"Erreur requête InfluxDB: {e}")
            return []
    
    # Si InfluxDB n'est pas disponible ou retourne une erreur, on retourne vide
    return []
    




