/**
 * Gestionnaire de configuration pour IAQverse
 * Charge et gère la configuration depuis le backend
 */

let config = null;
let configPromise = null;

/**
 * Charge la configuration depuis le backend.
 * Pas de cache persistant: chaque appel déclenche un fetch réseau.
 * Seule la promesse en cours est mutualisée pour éviter les requêtes doublons simultanées.
 * @returns {Promise<Object>} La configuration chargée
 */
async function loadConfig() {
    if (configPromise) return configPromise;

    // Fetch réseau (une seule promesse globale pour éviter les doublons simultanés)
    configPromise = (async () => {
        try {
            let token = null;
            try {
                token = await getAuthToken();
            } catch (e) {
                console.warn("Auth token not available yet", e);
            }
            
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch('/api/config', {
                headers,
                cache: 'no-store'
            });
            if (response.ok) {
                config = await response.json();
                return config;
            }
        } catch (error) {
            console.warn('Backend non disponible', error);
        }
        throw new Error('Impossible de charger la configuration');
    })();

    try {
        return await configPromise;
    } catch (error) {
        throw error;
    } finally {
        configPromise = null;
    }
}

async function saveConfig(updates = null) {
    try {
        const token = await getAuthToken();
        const headers = { 
            'Content-Type': 'application/json'
        };
        if (token) headers['Authorization'] = `Bearer ${token}`; 

        const dataToSend = updates || config;
        const response = await fetch('/api/config', {
            method: 'PUT',
            headers,
            body: JSON.stringify(dataToSend)
        });

        if (!response.ok) throw new Error('Erreur lors de la sauvegarde');

        // Re-fetch systématique après modification pour garantir la synchro avec l'état distant
        await loadConfig();

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

