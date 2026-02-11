/**
 * Script spécifique pour la page Dashboard (index.html)
 */

/**
 * Met à jour les graphiques en fonction de l'enseigne et de la salle sélectionnées
 * @param {string} enseigneId - L'ID de l'enseigne
 * @param {string} salleId - L'ID de la salle
 */
function updateCharts(enseigneId, salleId) {
    const config = getConfig();
    
    // Cherche les objets correspondants dans la configuration
    const enseigne = config.lieux.enseignes.find(e => e.id === enseigneId);
    const salle = enseigne?.pieces?.find(p => p.id === salleId);

    // ⚙️ Utilise les noms (Maison, Salon) pour l'API
    currentEnseigne = enseigne?.nom || enseigneId;
    currentSalle = salle?.nom || salleId;

    // Recharge les données et met à jour les graphiques
    if (typeof window.resetCharts === 'function') {
        window.resetCharts();
    }
    if (typeof window.fetchAndUpdate === 'function') {
        window.fetchAndUpdate();
    }
    
    // Mettre à jour le score prédit
    console.log(`[dashboard] Updating predicted score for ${enseigneId}/${salleId}`);
    fetchAndDisplayPredictedScore(enseigneId, salleId);
}

/**
 * Récupère et affiche le score prédit pour la salle courante
 */
async function fetchAndDisplayPredictedScore(enseigneId, salleId) {
    const scoreElement = document.getElementById('predicted-score-value');
    const trendElement = document.getElementById('predicted-score-trend');
    
    if (!scoreElement) {
        console.warn('[dashboard] Predicted score element not found');
        return;
    }

    try {
        const config = getConfig(); // Supposé disponible via config-loader.js
        if (!config) {
            console.warn('[dashboard] Config not ready yet');
            return;
        }

        const enseigne = config?.lieux?.enseignes?.find(e => e.id === enseigneId);
        const salle = enseigne?.pieces?.find(p => p.id === salleId);
        
        if (!enseigne || !salle) {
            console.warn(`[dashboard] Could not find enseigne/salle for ${enseigneId}/${salleId}`);
            return;
        }

        const params = new URLSearchParams({
            enseigne: enseigne.nom,
            salle: salle.nom
        });

        console.log(`[dashboard] Fetching prediction with params: ${params.toString()}`);

        const url = `${API_ENDPOINTS.preventiveActions}?${params}`;
        const response = await fetchWithRetry(url, {}, 1);
        
        if (!response.ok) {
             throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        // Support both structures (direct or nested in status)
        const predictedScore = data.status && data.status.predicted_score !== undefined 
            ? data.status.predicted_score 
            : data.predicted_score;

        if (predictedScore !== undefined && predictedScore !== null) {
             const roundedScore = Math.round(predictedScore);
             scoreElement.textContent = roundedScore;
             
             // Couleur en fonction du score
             scoreElement.classList.remove('text-success', 'text-warning', 'text-danger');
             if (roundedScore >= 80) scoreElement.style.color = 'var(--success)';
             else if (roundedScore >= 60) scoreElement.style.color = 'var(--warning)';
             else scoreElement.style.color = 'var(--danger)';

             if (trendElement) {
                 trendElement.textContent = ''; 
             }
        } else {
            scoreElement.textContent = '—';
        }
    } catch (error) {
        console.error('[dashboard] Error fetching predicted score:', error);
        scoreElement.textContent = '—';
    }
}

/**
 * Gestion de la modale d'info
 */
function openModal() {
    ModalManager.open('infoModal');
}

function closeModal() {
    ModalManager.close('infoModal');
}

// Écouter les changements de pièce pour mettre à jour les graphiques
document.addEventListener('roomChanged', (event) => {
    const { roomId, enseigneId } = event.detail;
    updateCharts(enseigneId, roomId);
});

// Export des fonctions
window.openModal = openModal;
window.closeModal = closeModal;
window.updateCharts = updateCharts;
window.fetchAndDisplayPredictedScore = fetchAndDisplayPredictedScore;

