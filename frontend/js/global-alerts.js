/**
 * Gestion globale des alertes (Modales)
 * Ce script est chargé sur toutes les pages pour garantir que l'utilisateur voit les alertes critiques.
 */

// HTML de la modale d'alerte (injecté dynamiquement si absent)
const ALERT_MODAL_HTML = `
<div id="alertEmailModal" class="modal" style="display: none; z-index: 9999;">
  <div class="modal-content alert-modal-content" style="text-align: center; border-left: 5px solid #e74c3c;">
    <span class="close" onclick="document.getElementById('alertEmailModal').style.display='none'">&times;</span>
    <div class="alert-icon-container" style="margin-bottom: 20px;">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
        <polyline points="22,6 12,13 2,6"></polyline>
      </svg>
    </div>
    <h2 style="color: #e74c3c; margin-bottom: 15px;">Alerte Envoyée !</h2>
    <p style="font-size: 1.1em; color: var(--text-color);">Un email a été envoyé automatiquement au syndicat.</p>
    
    <div class="alert-details-box" style="background-color: var(--card-bg); padding: 15px; border-radius: 8px; margin: 20px 0; text-align: left; border: 1px solid var(--border-color);">
      <p style="margin: 5px 0;"><strong>Salle:</strong> <span id="alert-modal-salle">-</span></p>
      <p style="margin: 5px 0;"><strong>Durée:</strong> <span id="alert-modal-duration">-</span> min</p>
      <p style="margin: 5px 0;"><strong>Niveau:</strong> <span id="alert-modal-level" style="text-transform: capitalize;">-</span></p>
    </div>
    
    <p style="font-size: 0.9em; color: #888; margin-bottom: 20px;">Une copie a été envoyée à l'assurance.</p>
    
    <button class="btn-primary" style="background-color: #e74c3c; border-color: #e74c3c; color: white; padding: 10px 20px; border-radius: 4px; cursor: pointer;" onclick="document.getElementById('alertEmailModal').style.display='none'">Je confirme</button>
  </div>
</div>
`;

function ensureAlertModalExists() {
    if (!document.getElementById('alertEmailModal')) {
        console.log('📢 Injection de la modale alerte dans le DOM');
        const div = document.createElement('div');
        div.innerHTML = ALERT_MODAL_HTML;
        document.body.appendChild(div.firstElementChild);
    }
}

function initGlobalAlerts() {
    // 1. S'assurer que le HTML est là
    ensureAlertModalExists();

    // 2. Écouter les WebSocket
    // Attendre que WS Manager soit prêt ou l'utiliser s'il est là
    if (window.wsManager) {
        setupAlertListener();
    } else {
        // Retry/Wait logic could go here, but usually scripts execute sequentially
        // Assuming websocket-manager.js is loaded before this script
        document.addEventListener('DOMContentLoaded', () => {
             if (window.wsManager) setupAlertListener();
        });
    }
}

function setupAlertListener() {
    // S'assurer de recevoir les alertes
    window.wsManager.subscribe(['alerts']);
    
    window.wsManager.on('alerts', (msg) => {
        console.log("🔔 Alerte reçue (Global):", msg);
        
        // Structure de message attendue:
        // { type: "alert_email_sent", data: { ... } }
        
        if (msg.type === 'alert_email_sent' && msg.data) {
            const details = msg.data;
            const modal = document.getElementById('alertEmailModal');
            if (modal) {
                // Update content
                const salleEl = document.getElementById('alert-modal-salle');
                const durEl = document.getElementById('alert-modal-duration');
                const levelEl = document.getElementById('alert-modal-level');
                
                if(salleEl) salleEl.textContent = details.salle || 'Inconnue';
                if(durEl) durEl.textContent = details.duration_minutes || '?';
                if(levelEl) levelEl.textContent = details.global_level || 'CRITICAL';
                
                // Show modal
                modal.style.display = 'flex'; // Use flex for centering (from CSS) or block
                console.log("✅ Modale affichée");
            } else {
                console.error("❌ ERREUR: Modale 'alertEmailModal' introuvable dans le DOM malgré l'injection.");
                // Tentative de réinjection de secours
                ensureAlertModalExists();
                const retryModal = document.getElementById('alertEmailModal');
                if (retryModal) retryModal.style.display = 'flex';
            }
        }
    });
}

// Démarrer une fois que le DOM est prêt (car script chargé dans le <head>)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalAlerts);
} else {
    initGlobalAlerts();
}
