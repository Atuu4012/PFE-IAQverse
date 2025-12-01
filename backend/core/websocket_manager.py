"""
WebSocket manager pour les communications en temps réel
"""
from fastapi import WebSocket, WebSocketDisconnect
from typing import List, Dict, Set, Optional
import json
import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Gestionnaire de connexions WebSocket pour les communications en temps réel.
    Gère les connexions clients et la diffusion de messages.
    """
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.subscriptions: Dict[str, Set[WebSocket]] = {
            "measurements": set(),
            "predictions": set(),
            "actions": set(),
            "alerts": set(),
            "modules": set(),
            "all": set()
        }
    
    async def connect(self, websocket: WebSocket, topics: List[str] = None):
        """
        Accepte une nouvelle connexion WebSocket et l'enregistre.
        
        Args:
            websocket: L'objet WebSocket
            topics: Liste des topics auxquels s'abonner (default: ["all"])
        """
        await websocket.accept()
        self.active_connections.append(websocket)
        
        # S'abonner aux topics demandés
        if topics is None:
            topics = ["all"]
        
        for topic in topics:
            if topic in self.subscriptions:
                self.subscriptions[topic].add(websocket)
        
        logger.info(f"✅ WebSocket connecté. Total: {len(self.active_connections)}, Topics: {topics}")
        
        # Envoyer un message de bienvenue
        await self.send_personal_message({
            "type": "connection",
            "status": "connected",
            "timestamp": datetime.utcnow().isoformat(),
            "subscriptions": topics
        }, websocket)
    
    def disconnect(self, websocket: WebSocket):
        """
        Déconnecte un WebSocket et le retire de toutes les souscriptions.
        """
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        
        # Retirer de toutes les souscriptions
        for topic_subs in self.subscriptions.values():
            topic_subs.discard(websocket)
        
        logger.info(f"❌ WebSocket déconnecté. Total: {len(self.active_connections)}")
    
    async def send_personal_message(self, message: Dict, websocket: WebSocket):
        """Envoie un message à une connexion spécifique"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Erreur envoi message personnel: {e}")
            self.disconnect(websocket)
    
    async def broadcast(self, message: Dict, topic: str = "all"):
        """
        Diffuse un message à tous les clients abonnés à un topic.
        
        Args:
            message: Le message à envoyer (dict)
            topic: Le topic ciblé (measurements, predictions, actions, alerts, modules, all)
        """
        if topic not in self.subscriptions:
            logger.warning(f"Topic inconnu: {topic}")
            return
        
        # Envoyer aux abonnés du topic spécifique
        subscribers = self.subscriptions[topic].copy()
        
        # Envoyer aussi aux abonnés "all"
        if topic != "all":
            subscribers.update(self.subscriptions["all"])
        
        disconnected = []
        
        for connection in subscribers:
            try:
                await connection.send_json(message)
            except WebSocketDisconnect:
                disconnected.append(connection)
            except Exception as e:
                logger.error(f"Erreur broadcast WebSocket: {e}")
                disconnected.append(connection)
        
        # Nettoyer les connexions mortes
        for conn in disconnected:
            self.disconnect(conn)
    
    async def broadcast_measurement(self, data: Dict):
        """
        Diffuse une nouvelle mesure IAQ.
        
        Format:
        {
            "type": "measurement",
            "timestamp": "2025-11-18T10:05:00Z",
            "sensor_id": "bureau1",
            "enseigne": "Maison",
            "salle": "Bureau",
            "values": {...}
        }
        """
        message = {
            "type": "measurement",
            "timestamp": datetime.utcnow().isoformat(),
            **data
        }
        await self.broadcast(message, "measurements")
    
    async def broadcast_prediction(self, data: Dict):
        """
        Diffuse une nouvelle prédiction.
        
        Format:
        {
            "type": "prediction",
            "timestamp": "2025-11-18T10:05:00Z",
            "sensor_id": "bureau1",
            "enseigne": "Maison",
            "salle": "Bureau",
            "predictions": {...},
            "forecast_minutes": 30
        }
        """
        message = {
            "type": "prediction",
            "timestamp": datetime.utcnow().isoformat(),
            **data
        }
        await self.broadcast(message, "predictions")
    
    async def broadcast_action(self, data: Dict):
        """
        Diffuse l'exécution d'une action.
        
        Format:
        {
            "type": "action",
            "timestamp": "2025-11-18T10:05:00Z",
            "enseigne": "Maison",
            "salle": "Bureau",
            "module_type": "ventilation",
            "action_type": "turn_on",
            "priority": "high"
        }
        """
        message = {
            "type": "action",
            "timestamp": datetime.utcnow().isoformat(),
            **data
        }
        await self.broadcast(message, "actions")
    
    async def broadcast_alert(self, data: Dict):
        """
        Diffuse une alerte IAQ.
        
        Format:
        {
            "type": "alert",
            "timestamp": "2025-11-18T10:05:00Z",
            "enseigne": "Maison",
            "salle": "Bureau",
            "level": "warning",
            "parameter": "CO2",
            "value": 1200,
            "message": "..."
        }
        """
        message = {
            "type": "alert",
            "timestamp": datetime.utcnow().isoformat(),
            **data
        }
        await self.broadcast(message, "alerts")
    
    async def broadcast_module_state(self, data: Dict):
        """
        Diffuse un changement d'état de module.
        
        Format:
        {
            "type": "module_state",
            "timestamp": "2025-11-18T10:05:00Z",
            "enseigne": "Maison",
            "salle": "Bureau",
            "module_type": "ventilation",
            "state": "active",
            "parameters": {...}
        }
        """
        message = {
            "type": "module_state",
            "timestamp": datetime.utcnow().isoformat(),
            **data
        }
        await self.broadcast(message, "modules")
    
    def get_stats(self) -> Dict:
        """Retourne les statistiques des connexions"""
        return {
            "total_connections": len(self.active_connections),
            "subscriptions": {
                topic: len(subs) 
                for topic, subs in self.subscriptions.items()
            }
        }


# Instance globale du gestionnaire de connexions
ws_manager = ConnectionManager()


def get_websocket_manager() -> ConnectionManager:
    """Retourne l'instance globale du gestionnaire WebSocket"""
    return ws_manager
