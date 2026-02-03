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
        let token = null;
        try {
            token = await getAuthToken(); // Nouvelle ligne
        } catch (e) {
            console.warn("Auth token not available yet", e);
        }
        
        const headers = { 
            'ngrok-skip-browser-warning': 'true' 
        };
        // Injection du token
        if (token) headers['Authorization'] = `Bearer ${token}`; 

        const response = await fetch('/api/config', { headers });
        if (response.ok) {
            config = await response.json();
            return config;
        }
    } catch (error) {
        console.warn('Backend non disponible', error);
    }
    throw new Error('Impossible de charger la configuration');
}

async function saveConfig(updates = null) {
    try {
        const token = await getAuthToken(); // Nouvelle ligne
        const headers = { 
            'Content-Type': 'application/json'
        };
        // Injection du token
        if (token) headers['Authorization'] = `Bearer ${token}`; 

        const dataToSend = updates || config;
        const response = await fetch('/api/config', {
            method: 'PUT',
            headers,
            body: JSON.stringify(dataToSend)
        });

        if (!response.ok) throw new Error('Erreur lors de la sauvegarde');

        const result = await response.json();
        if (result && result.config) config = result.config;

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
