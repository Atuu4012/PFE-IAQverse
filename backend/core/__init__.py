"""
Core services for IAQverse
Simplified architecture - essential services only
"""
from .settings import Settings, settings
from .influx_client import get_influx_client, InfluxDBClient
from .websocket_manager import get_websocket_manager, ConnectionManager
from .alert_service import AlertService

_alert_service = None

def get_alert_service():
    global _alert_service
    if _alert_service is None:
        ws_manager = get_websocket_manager()
        _alert_service = AlertService(ws_manager)
    return _alert_service

__all__ = [
    "Settings",
    "settings",
    "get_influx_client",
    "InfluxDBClient",
    "get_websocket_manager",
    "ConnectionManager",
    "get_alert_service",
    "AlertService"
]
