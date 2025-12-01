"""
Configuration centrale pour l'application IAQverse
"""
from pathlib import Path
from typing import Optional
import os


class Settings:
    """Configuration globale de l'application"""
    
    # Application
    APP_NAME: str = "IAQverse"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False
    
    # API
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    API_WORKERS: int = 1
    
    # CORS
    CORS_ORIGINS: list = ["*"]
    
    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    ASSETS_DIR: Path = BASE_DIR / "assets"
    CONFIG_FILE: Path = ASSETS_DIR / "config.json"
    ML_MODELS_DIR: Path = ASSETS_DIR / "ml_models"
    DATASETS_DIR: Path = ASSETS_DIR / "datasets"
    ROOMS_DIR: Path = ASSETS_DIR / "rooms"
    
    # InfluxDB
    INFLUXDB_ENABLED: bool = os.getenv("INFLUXDB_ENABLED", "false").lower() == "true"
    INFLUXDB_URL: str = os.getenv("INFLUXDB_URL", "http://localhost:8086")
    INFLUXDB_TOKEN: Optional[str] = os.getenv("INFLUXDB_TOKEN")
    INFLUXDB_ORG: str = os.getenv("INFLUXDB_ORG", "iaqverse")
    INFLUXDB_BUCKET: str = os.getenv("INFLUXDB_BUCKET", "iaq_data")
    
    # SQLite
    SQLITE_DB_PATH: Path = BASE_DIR / "database" / "sqlite.db"
    
    # WebSocket
    WEBSOCKET_ENABLED: bool = os.getenv("WEBSOCKET_ENABLED", "true").lower() == "true"
    WEBSOCKET_PING_INTERVAL: int = int(os.getenv("WEBSOCKET_PING_INTERVAL", "30"))
    WEBSOCKET_PING_TIMEOUT: int = int(os.getenv("WEBSOCKET_PING_TIMEOUT", "10"))
    
    # MQTT (optionnel)
    MQTT_ENABLED: bool = os.getenv("MQTT_ENABLED", "false").lower() == "true"
    MQTT_BROKER: str = os.getenv("MQTT_BROKER", "localhost")
    MQTT_PORT: int = int(os.getenv("MQTT_PORT", "1883"))
    MQTT_USERNAME: Optional[str] = os.getenv("MQTT_USERNAME")
    MQTT_PASSWORD: Optional[str] = os.getenv("MQTT_PASSWORD")
    MQTT_TOPIC_PREFIX: str = os.getenv("MQTT_TOPIC_PREFIX", "iaqverse")
    
    # ML Services
    ML_PREDICTOR_INTERVAL: int = int(os.getenv("ML_PREDICTOR_INTERVAL", "600"))  # 10 minutes
    ML_TRAINER_INTERVAL: int = int(os.getenv("ML_TRAINER_INTERVAL", "86400"))  # 24 heures
    ML_FORECAST_MINUTES: int = int(os.getenv("ML_FORECAST_MINUTES", "30"))
    
    # Data retention
    DATA_RETENTION_DAYS: int = int(os.getenv("DATA_RETENTION_DAYS", "90"))
    MAX_MEMORY_RECORDS: int = int(os.getenv("MAX_MEMORY_RECORDS", "10000"))


# Instance globale
settings = Settings()
