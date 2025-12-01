#!/usr/bin/env python3
"""
Script de test pour le WebSocket IAQverse
Simule l'envoi de mesures et vérifie la réception via WebSocket
"""
import asyncio
import websockets
import json
import requests
from datetime import datetime
import time

# Configuration
API_URL = "http://localhost:8000/api/ingest"
WS_URL = "ws://localhost:8000/ws"

async def test_websocket_client():
    """Test du client WebSocket"""
    print("🔌 Connexion au WebSocket...")
    
    try:
        async with websockets.connect(WS_URL) as websocket:
            print("✅ WebSocket connecté!")
            
            # S'abonner aux mesures
            subscribe_msg = {
                "type": "subscribe",
                "topics": ["measurements"]
            }
            await websocket.send(json.dumps(subscribe_msg))
            print(f"📢 Abonné aux topics: {subscribe_msg['topics']}")
            
            # Écouter les messages pendant 30 secondes
            print("\n👂 Écoute des messages (30 secondes)...\n")
            
            timeout = time.time() + 30
            message_count = 0
            
            while time.time() < timeout:
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=2.0)
                    data = json.loads(message)
                    message_count += 1
                    
                    if data.get('type') == 'measurement':
                        print(f"📊 Mesure #{message_count}: {data.get('salle')} - CO2: {data.get('co2')}ppm")
                    else:
                        print(f"📩 Message: {data.get('type')}")
                        
                except asyncio.TimeoutError:
                    # Envoyer un ping pour maintenir la connexion
                    await websocket.send(json.dumps({"type": "ping"}))
                    print("🏓 Ping envoyé")
                    
            print(f"\n✅ Test terminé. Messages reçus: {message_count}")
            
    except Exception as e:
        print(f"❌ Erreur WebSocket: {e}")

def test_http_ingest():
    """Test de l'ingestion HTTP"""
    print("\n📤 Test d'ingestion HTTP...")
    
    measurement = {
        "sensor_id": "test_sensor",
        "enseigne": "Maison",
        "salle": "Bureau",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "values": {
            "CO2": 650,
            "PM25": 15,
            "TVOC": 0.3,
            "Temperature": 22.5,
            "Humidity": 48
        }
    }
    
    try:
        response = requests.post(API_URL, json=measurement)
        if response.status_code == 200:
            print(f"✅ Mesure ingérée: {response.json()}")
        else:
            print(f"❌ Erreur HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"❌ Erreur requête: {e}")

def get_websocket_stats():
    """Récupère les stats WebSocket"""
    print("\n📊 Stats WebSocket:")
    
    try:
        response = requests.get("http://localhost:8000/ws/stats")
        if response.status_code == 200:
            stats = response.json()
            print(f"  Connexions actives: {stats.get('active_connections', 0)}")
            print(f"  Subscriptions: {stats.get('subscriptions', {})}")
        else:
            print(f"❌ Erreur HTTP {response.status_code}")
    except Exception as e:
        print(f"❌ Erreur: {e}")

async def main():
    """Programme principal"""
    print("=" * 60)
    print("  IAQverse WebSocket Test Suite")
    print("=" * 60)
    
    # 1. Vérifier les stats initiales
    get_websocket_stats()
    
    # 2. Démarrer le client WebSocket
    print("\n" + "=" * 60)
    await test_websocket_client()
    
    # 3. Tester l'ingestion HTTP (optionnel)
    # test_http_ingest()
    
    # 4. Vérifier les stats finales
    print("\n" + "=" * 60)
    get_websocket_stats()
    
    print("\n✅ Tests terminés!")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️ Test interrompu par l'utilisateur")
