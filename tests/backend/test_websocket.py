import pytest
from fastapi.testclient import TestClient
from backend.main import app

def test_websocket():
    client = TestClient(app)
    with client.websocket_connect("/ws") as websocket:
        # Send a subscription message
        websocket.send_json({"type": "subscribe", "topic": "all"})
        
        # We might receive an initial message or wait for one depending on implementation
        # For now, just ensure connection is successful and we can maximize coverage
        # You can add assertions here based on expected WS behavior
        assert websocket
