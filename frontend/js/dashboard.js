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
