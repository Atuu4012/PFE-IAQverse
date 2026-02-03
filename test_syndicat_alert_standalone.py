import sys
import os
import asyncio
import logging
from datetime import datetime

# Définir le niveau de log
logging.basicConfig(level=logging.INFO)

# Ajouter le dossier racine au path pour les imports
sys.path.append(os.path.abspath('.'))

try:
    from dotenv import load_dotenv
    load_dotenv() # Charger les variables .env
except ImportError:
    print("⚠️  python-dotenv non installé, assurez-vous que les variables d'env sont définies.")

# Imports du backend
try:
    from backend.core.email_sender import EmailSender
    from backend.core.alert_service import AlertService
except ImportError as e:
    print(f"❌ Erreur d'import: {e}")
    print("Assurez-vous d'exécuter ce script depuis la racine du projet (là où est backend/)")
    sys.exit(1)

# Mock pour le WebSocket Manager
class MockWebSocketManager:
    async def broadcast(self, message, topic="all"):
        print(f"\n📡 [MOCK WS] Diffusion simulée sur le topic '{topic}'")
        print(f"   Contenu: {message}")
        print("   (Si le serveur tournait, la modale rouge s'afficherait maintenant sur le frontend)\n")

async def test_alert_system():
    print("="*60)
    print("🧪 TEST DU SYSTÈME D'ALERTE SYNDICAT")
    print("="*60)

    # 1. Test direct de l'envoi d'email
    print("\n📧 Étape 1: Test technique de l'envoi d'email...")
    sender = EmailSender()
    
    if not sender.password:
        print("❌ Erreur: SMTP_PASSWORD non trouvé dans les variables d'environnement.")
        print("   Vérifiez votre fichier .env")
        return

    test_details = {
        "salle": "SALLE DE TEST (SCRIPT)",
        "sensor_id": "TEST_SENSOR_001",
        "global_level": "very_poor",
        "global_score": 15,
        "start_time": datetime.utcnow().strftime("%H:%M"),
        "duration_minutes": 999
    }

    try:
        print("   Tentative d'envoi vers le syndicat configuré...")
        success = sender.send_alert_email(test_details)
        if success:
            print("✅ Email envoyé avec succès ! Vérifiez la boîte de réception du syndicat.")
        else:
            print("❌ Échec de l'envoi de l'email.")
    except Exception as e:
        print(f"❌ Exception lors de l'envoi: {e}")

    # 2. Test du service d'alerte (Logique temporelle)
    print("\n⏱️  Étape 2: Simulation de la logique temporelle (AlertService)...")
    ws_mock = MockWebSocketManager()
    service = AlertService(ws_mock)
    
    # Raccourcir considérablement le délai pour le test (ex: 2 secondes au lieu de 30min)
    service.alert_delay_minutes = 0.05  # ~3 secondes
    print(f"   Configuration délai alerte: {service.alert_delay_minutes} minutes (pour le test)")

    sensor_id = "TEST_LOGIC_SENSOR"
    salle_name = "Salle Simulation"
    bad_iaq = {"global_level": "poor", "global_score": 45}

    # T0: Première détection
    print("   [T=0s] Signalement qualité 'poor' (avec optimal_state=True)...")
    await service.check_alert_condition(sensor_id, salle_name, bad_iaq, optimal_state=True)
    
    if sensor_id in service.active_alerts:
        print("   ✅ Dégradation détectée et enregistrée.")
    else:
        print("   ❌ Erreur: La dégradation n'a pas été enregistrée.")

    # T+4s: Deuxième détection après délai
    print("   [Attente de 4 secondes...]")
    await asyncio.sleep(4)
    
    print("   [T=4s] Signalement qualité 'poor' toujours en cours...")
    # Cela devrait déclencher l'alerte (Email + WS)
    await service.check_alert_condition(sensor_id, salle_name, bad_iaq, optimal_state=True)
    
    print("\n✅ Test terminé.")

if __name__ == "__main__":
    asyncio.run(test_alert_system())
