// Script pour simuler une alerte sans attendre 30min
// À exécuter directement dans la console du navigateur (F12)

function forceAlertModal(timeout = 0) {
    console.log("Simulation force de la modale d'alerte...");
    
    // Simuler le message WebSocket attendu par le dashboard.js
    const fakeMessage = {
        type: 'alert_email_sent',
        data: {
            salle: 'Simulation Room',
            sensor_id: 'SIM_001',
            global_level: 'critical',
            global_score: 15,
            duration_minutes: 42,
            start_time: '14:00'
        }
    };
    
    setTimeout(() => {
        // Obtenir le manager WebSocket s'il existe
        if (window.wsManager) {
            console.log("Injection de l'alerte via WebSocketManager listeners");
            // On notifie manuellement les listeners du topic 'alerts'
            window.wsManager.notifyListeners('alerts', fakeMessage);
        } else {
            console.error("WebSocketManager non trouvé (wsManager)");
        }
    }, timeout);
}

// Pour faciliter l'accès, on l'attache à window
window.forceAlertModal = forceAlertModal;

console.log("Commande chargée: window.forceAlertModal() pour tester");