import logging
from datetime import datetime
from .email_sender import EmailSender
from .websocket_manager import ConnectionManager

logger = logging.getLogger(__name__)

class AlertService:
    def __init__(self, websocket_manager: ConnectionManager):
        self.email_sender = EmailSender()
        self.ws_manager = websocket_manager
        # Dict to store start time of poor quality per sensor: {sensor_id: datetime}
        self.active_alerts = {}
        # Configuration: how long to wait before sending email (minutes)
        self.alert_delay_minutes = 30 
        # Avoid spamming: when was the last email sent for this sensor {sensor_id: datetime}
        self.last_email_sent = {}
        # Min time between emails (e.g., 24 hours)
        self.email_cooldown_minutes = 1440


    async def check_alert_condition(self, sensor_id: str, salle: str, iaq_score: dict, optimal_state: bool = False):
        """
        Vérifie si une alerte doit être déclenchée.
        Le paramètre optimal_state indique si les actionneurs sont dans l'état recommandé 
        (ex: fenêtres ouvertes si CO2 haut, mais aussi fermées si c'est le mieux à faire).
        """
        if not sensor_id:
            return

        level = iaq_score.get('global_level')
        score = iaq_score.get('global_score', 100)
        
        # Condition de déclenchement: 'poor' ou 'very_poor' (ou score < 50)
        is_bad_quality = level in ['poor', 'very_poor'] or score < 50
        
        if is_bad_quality:
            now = datetime.utcnow()
            
            # Si c'est le début du problème
            if sensor_id not in self.active_alerts:
                self.active_alerts[sensor_id] = now
                logger.info(f"⚠️ Début dégradation qualité air ({salle}): {level}")
            
            # Vérifier la durée
            start_time = self.active_alerts[sensor_id]
            duration = (now - start_time).total_seconds() / 60
            
            # LOGIQUE AMÉLIORÉE (Basée sur l'Etat Optimal): 
            # Si le système est dans l'état optimal (les actionneurs sont dans le bon état,
            # que ce soit ouvert ou fermé selon la situation) MAIS que la qualité reste mauvaise.
            # Alors on considère que la stratégie échoue et on alerte plus vite.
            
            threshold_minutes = self.alert_delay_minutes
            if optimal_state:
                threshold_minutes = max(15, self.alert_delay_minutes / 2)
            
            if duration >= threshold_minutes and optimal_state:
                logger.warning(f"🚨 CONFIG OPTIMALE INEFFICACE ({duration:.0f}min) - Qualité '{level}' persistante.")
            
            # Condition d'envoi
            should_alert = (duration >= threshold_minutes and optimal_state) or (duration >= self.alert_delay_minutes)

            if should_alert:
                # Vérifier cooldown
                last_sent = self.last_email_sent.get(sensor_id)
                if not last_sent or (now - last_sent).total_seconds() > (self.email_cooldown_minutes * 60):
                    # ENVOYER L'ALERTE
                    logger.warning(f"🚨 ALERTE PERSISTANTE ({duration:.0f}min) - Envoi email pour {salle}")
                    
                    alert_details = {
                        "salle": salle,
                        "sensor_id": sensor_id,
                        "global_level": level,
                        "global_score": score,
                        "start_time": start_time.strftime("%H:%M"),
                        "duration_minutes": int(duration),
                        "optimal_state": optimal_state  # Info pour le mail
                    }
                    
                    # 1. Envoi Email

                    # Note: L'envoi d'email est bloquant, idéalement à faire dans un thread/background task
                    # Pour la simplicité ici, on le fait direct (ou via un wrapper async si on voulait)
                    try:
                        success = self.email_sender.send_alert_email(alert_details)
                        
                        if success:
                            self.last_email_sent[sensor_id] = now
                            
                            # 2. Notifier Frontend via WebSocket pour la Modale
                            await self.ws_manager.broadcast({
                                "type": "alert_email_sent", 
                                "data": alert_details
                            }, topic="alerts")
                    except Exception as e:
                        logger.error(f"Erreur process alerte: {e}")

        else:
            # Qualité rétablie
            if sensor_id in self.active_alerts:
                del self.active_alerts[sensor_id]
                logger.info(f"✅ Qualité air rétablie ({salle})")
