"""
Client InfluxDB pour le stockage des séries temporelles IAQ
"""
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class InfluxDBClient:
    """
    Client pour interagir avec InfluxDB.
    Gère le stockage et la récupération des données de séries temporelles.
    """
    
    def __init__(self, url: str, token: str, org: str, bucket: str):
        self.url = url
        self.token = token
        self.org = org
        self.bucket = bucket
        self.client = None
        self.write_api = None
        self.query_api = None
        self._available = False
        
        self._init_client()
    
    def _init_client(self):
        """Initialise la connexion à InfluxDB si disponible"""
        try:
            from influxdb_client import InfluxDBClient as InfluxClient
            from influxdb_client.client.write_api import SYNCHRONOUS
            
            self.client = InfluxClient(
                url=self.url,
                token=self.token,
                org=self.org
            )
            
            # Test de connexion
            self.client.ping()
            
            self.write_api = self.client.write_api(write_options=SYNCHRONOUS)
            self.query_api = self.client.query_api()
            self._available = True
            
            logger.info(f"✅ InfluxDB connecté: {self.url}")
            
        except ImportError:
            logger.warning("⚠️  influxdb-client non installé. Fonctionnement en mode mémoire.")
        except Exception as e:
            logger.warning(f"⚠️  InfluxDB non disponible: {e}. Fonctionnement en mode mémoire.")
    
    @property
    def available(self) -> bool:
        """Vérifie si InfluxDB est disponible"""
        return self._available
    
    def write_measurement(self, data: Dict[str, Any]) -> bool:
        """
        Écrit une mesure IAQ dans InfluxDB.
        
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
        if not self._available:
            return False
        
        try:
            from influxdb_client import Point
            
            sensor_id = data.get("sensor_id", "unknown")
            enseigne = data.get("enseigne", "unknown")
            salle = data.get("salle", "unknown")
            timestamp = data.get("timestamp", datetime.utcnow().isoformat())
            values = data.get("values", {})
            
            # Créer le point InfluxDB
            point = Point("iaq_raw") \
                .tag("sensor_id", sensor_id) \
                .tag("enseigne", enseigne) \
                .tag("salle", salle) \
                .time(timestamp)
            
            # Ajouter les champs de mesure
            for key, value in values.items():
                if value is not None:
                    point = point.field(key.lower(), float(value))
            
            # Écrire dans InfluxDB
            self.write_api.write(bucket=self.bucket, record=point)
            return True
            
        except Exception as e:
            logger.error(f"Erreur écriture InfluxDB: {e}")
            return False
    
    def write_prediction(self, data: Dict[str, Any]) -> bool:
        """Écrit une prédiction ML dans InfluxDB"""
        if not self._available:
            return False
        
        try:
            from influxdb_client import Point
            
            sensor_id = data.get("sensor_id", "unknown")
            enseigne = data.get("enseigne", "unknown")
            salle = data.get("salle", "unknown")
            timestamp = data.get("timestamp", datetime.utcnow().isoformat())
            predictions = data.get("predictions", {})
            forecast_minutes = data.get("forecast_minutes", 30)
            
            point = Point("iaq_forecast") \
                .tag("sensor_id", sensor_id) \
                .tag("enseigne", enseigne) \
                .tag("salle", salle) \
                .tag("forecast_minutes", str(forecast_minutes)) \
                .time(timestamp)
            
            for key, value in predictions.items():
                if value is not None:
                    point = point.field(f"predicted_{key.lower()}", float(value))
            
            self.write_api.write(bucket=self.bucket, record=point)
            return True
            
        except Exception as e:
            logger.error(f"Erreur écriture prédiction InfluxDB: {e}")
            return False
    
    def write_action(self, data: Dict[str, Any]) -> bool:
        """Écrit une action exécutée dans InfluxDB"""
        if not self._available:
            return False
        
        try:
            from influxdb_client import Point
            
            timestamp = data.get("timestamp", datetime.utcnow().isoformat())
            enseigne = data.get("enseigne", "unknown")
            salle = data.get("salle", "unknown")
            module_type = data.get("module_type", "unknown")
            action_type = data.get("action_type", "unknown")
            priority = data.get("priority", "low")
            
            point = Point("iaq_actions") \
                .tag("enseigne", enseigne) \
                .tag("salle", salle) \
                .tag("module_type", module_type) \
                .tag("action_type", action_type) \
                .tag("priority", priority) \
                .field("executed", 1) \
                .time(timestamp)
            
            self.write_api.write(bucket=self.bucket, record=point)
            return True
            
        except Exception as e:
            logger.error(f"Erreur écriture action InfluxDB: {e}")
            return False
    
    def write_score(self, data: Dict[str, Any]) -> bool:
        """Écrit un score IAQ dans InfluxDB"""
        if not self._available:
            return False
        
        try:
            from influxdb_client import Point
            
            sensor_id = data.get("sensor_id", "unknown")
            enseigne = data.get("enseigne", "unknown")
            salle = data.get("salle", "unknown")
            timestamp = data.get("timestamp", datetime.utcnow().isoformat())
            score = data.get("score", 0)
            level = data.get("level", "unknown")
            
            point = Point("iaq_scores") \
                .tag("sensor_id", sensor_id) \
                .tag("enseigne", enseigne) \
                .tag("salle", salle) \
                .tag("level", level) \
                .field("score", float(score)) \
                .time(timestamp)
            
            self.write_api.write(bucket=self.bucket, record=point)
            return True
            
        except Exception as e:
            logger.error(f"Erreur écriture score InfluxDB: {e}")
            return False
    
    def query_measurements(
        self,
        enseigne: Optional[str] = None,
        salle: Optional[str] = None,
        sensor_id: Optional[str] = None,
        start: str = "-24h",
        stop: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Récupère les mesures depuis InfluxDB"""
        if not self._available:
            return []
        
        try:
            # Construire la requête Flux
            filters = []
            if enseigne:
                filters.append(f'r["enseigne"] == "{enseigne}"')
            if salle:
                filters.append(f'r["salle"] == "{salle}"')
            if sensor_id:
                filters.append(f'r["sensor_id"] == "{sensor_id}"')
            
            filter_str = " and ".join(filters) if filters else ""
            if filter_str:
                filter_str = f"|> filter(fn: (r) => {filter_str})"
            
            query = f'''
            from(bucket: "{self.bucket}")
                |> range(start: {start}{f', stop: {stop}' if stop else ''})
                |> filter(fn: (r) => r["_measurement"] == "iaq_raw")
                {filter_str}
            '''
            
            tables = self.query_api.query(query)
            
            # Transformer les résultats
            results = []
            for table in tables:
                for record in table.records:
                    results.append({
                        "timestamp": record.get_time().isoformat(),
                        "sensor_id": record.values.get("sensor_id"),
                        "enseigne": record.values.get("enseigne"),
                        "salle": record.values.get("salle"),
                        "field": record.get_field(),
                        "value": record.get_value()
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"Erreur requête InfluxDB: {e}")
            return []
    
    def query_data(self, flux_query: str) -> List[Dict[str, Any]]:
        """
        Exécute une requête Flux et retourne les résultats au format JSON simple.
        Utilisé par l'API pour récupérer les données avec pivot.
        Normalise les noms de champs en minuscules pour compatibilité ML.
        """
        if not self._available:
            return []
        
        try:
            tables = self.query_api.query(flux_query)
            
            results = []
            for table in tables:
                for record in table.records:
                    # Créer un dict avec tous les champs du record
                    row = {
                        "timestamp": record.get_time().isoformat(),
                    }
                    # Ajouter toutes les valeurs (tags + fields)
                    for key, value in record.values.items():
                        if key not in ["_time", "_start", "_stop", "_measurement", "result", "table"]:
                            if key.startswith("_"):
                                continue
                            # Normaliser les noms en minuscules pour compatibilité
                            normalized_key = key.lower()
                            row[normalized_key] = value
                    
                    results.append(row)
            
            return results
            
        except Exception as e:
            logger.error(f"Erreur query_data InfluxDB: {e}")
            return []
    
    def close(self):
        """Ferme la connexion InfluxDB"""
        if self.client:
            try:
                self.client.close()
                logger.info("InfluxDB connexion fermée")
            except Exception as e:
                logger.error(f"Erreur fermeture InfluxDB: {e}")


# Instance globale (sera initialisée si InfluxDB est configuré)
_influx_client: Optional[InfluxDBClient] = None


def get_influx_client(
    url: str = None,
    token: str = None,
    org: str = None,
    bucket: str = None
) -> Optional[InfluxDBClient]:
    """Retourne l'instance du client InfluxDB"""
    global _influx_client
    
    if _influx_client is None and all([url, token, org, bucket]):
        _influx_client = InfluxDBClient(url, token, org, bucket)
    
    return _influx_client
