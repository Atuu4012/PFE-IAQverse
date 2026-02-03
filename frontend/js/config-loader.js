/**
 * Gestionnaire de configuration pour IAQverse
 * Charge et gère la configuration depuis le backend ou le fichier statique
 */

let config = null;

/**
 * Charge la configuration depuis le backend
 * @returns {Promise<Object>} La configuration chargée
 */
async function loadConfig() {
    try {
        // Essayer d'abord l'API du backend (via le reverse proxy)
        const response = await fetch('/api/config', {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (response.ok) {
            config = await response.json();
            return config;
        }
    } catch (error) {
        console.warn('Backend non disponible');
    }

    throw new Error('Impossible de charger la configuration');
}

/**
 * Sauvegarde la configuration sur le backend
 * @param {Object} updates - Les mises à jour à appliquer
 * @returns {Promise<Object>} La configuration mise à jour
 */
async function saveConfig(updates = null) {
    try {
        const dataToSend = updates || config;
        // Utiliser le chemin relatif via le reverse proxy
        const response = await fetch('/api/config', {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(dataToSend)
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la sauvegarde');
        }

        const result = await response.json();
        if (result && result.config) {
            config = result.config;
        }

        return config;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        throw error;
    }
}

/**
 * Obtient la configuration actuelle
 * @returns {Object} La configuration
 */
function getConfig() {
    return config;
}

/**
 * Met à jour la configuration locale
 * @param {Object} newConfig - La nouvelle configuration
 */
function setConfig(newConfig) {
    config = newConfig;
}

// Export des fonctions
window.loadConfig = loadConfig;
window.saveConfig = saveConfig;
window.getConfig = getConfig;
window.setConfig = setConfig;
