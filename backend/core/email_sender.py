import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
import logging

logger = logging.getLogger(__name__)

class EmailSender:
    def __init__(self, user_id: str = ""):
        self.user_id = user_id
        self.smtp_server = "smtp.gmail.com"
        self.smtp_port = 587
        self.password = os.getenv("SMTP_PASSWORD")
        self.config = self._load_config()
        
    def _load_config(self):
        try:
            from ..utils import load_user_config
            if self.user_id:
                cfg = load_user_config(self.user_id)
                if cfg:
                    return cfg
        except Exception as e:
            logger.error(f"Erreur chargement config email depuis Supabase: {e}")
        return {}

    def send_alert_email(self, alert_details):
        # Vérification du paramètre d'activation
        email_enabled = self.config.get("alert_system", {}).get("email_notifications", True)
        if not email_enabled:
            logger.info("🚫 Envoi d'email désactivé dans la configuration")
            return False

        if not self.password:
            logger.error("SMTP_PASSWORD non défini. Impossible d'envoyer l'email.")
            return False

        sender_email = self.config.get("vous", {}).get("email")
        syndicat_email = self.config.get("syndicat", {}).get("email")
        assurance_email = self.config.get("assurance", {}).get("email")

        if not sender_email or not syndicat_email:
            logger.error("Emails expéditeur ou destinataire manquants dans la config.")
            return False

        subject = f"URGENT: Problème Qualité d'Air Persistant - {alert_details.get('salle', 'General')}"
        
        body = f"""
        <html>
          <body>
            <h2>Alerte Qualité d'Air</h2>
            <p>Bonjour,</p>
            <p>Ce message est une alerte automatique générée par le système IAQverse.</p>
            <p>La qualité de l'air dans <strong>{alert_details.get('salle', 'la pièce')}</strong> reste critique depuis plus de {alert_details.get('duration_minutes', 30)} minutes.</p>
            
            <p><strong>Raison de l'appel :</strong> { "Malgré les actionneurs en marche, la qualité de l'air ne s'améliore pas." if alert_details.get('optimal_state') else "Niveau critique persistant sans amélioration." }</p>

            <h3>Détails:</h3>
            <ul>
                <li><strong>Niveau Global:</strong> {alert_details.get('global_level', 'CRITICAL')}</li>
                <li><strong>Capteur:</strong> {alert_details.get('sensor_id', 'N/A')}</li>
                <li><strong>Heure début alerte:</strong> {alert_details.get('start_time')}</li>
            </ul>
            
            <p>Merci d'intervenir rapidement.</p>
            <p>Cordialement,<br>{self.config.get('vous', {}).get('prenom')} {self.config.get('vous', {}).get('nom')}</p>
          </body>
        </html>
        """

        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = syndicat_email
        msg['Cc'] = assurance_email
        msg['Subject'] = subject

        msg.attach(MIMEText(body, 'html'))

        recipients = [syndicat_email]
        if assurance_email:
            recipients.append(assurance_email)

        try:
            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(sender_email, self.password)
            server.sendmail(sender_email, recipients, msg.as_string())
            server.quit()
            logger.info(f"📧 Email d'alerte envoyé à {syndicat_email} (Cc: {assurance_email})")
            return True
        except Exception as e:
            logger.error(f"❌ Erreur envoi email: {e}")
            return False

