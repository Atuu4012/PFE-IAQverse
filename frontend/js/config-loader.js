/**
 * Gestionnaire de configuration pour IAQverse
 * Charge et gère la configuration depuis le backend ou le fichier statique
 */

let config = null;

/**
 * Charge la configuration depuis le backend ou le fichier statique
 * @returns {Promise<Object>} La configuration chargée
 */
async function loadConfig() {
    try {
        // Essayer d'abord l'API du backend
        const response = await fetch('http://localhost:8000/config');
        if (response.ok) {
            config = await response.json();
            console.log('Configuration chargée depuis le backend');
            return config;
        }
    } catch (error) {
        console.warn('Backend non disponible, tentative de chargement du fichier statique');
    }

    // Sinon essayer de charger le fichier statique
    const candidates = ['/assets/config.json', '../assets/config.json', 'assets/config.json'];
    for (const path of candidates) {
        try {
            const response = await fetch(path, { cache: 'no-store' });
            if (!response.ok) continue;
            config = await response.json();
            console.log(`Configuration chargée depuis ${path}`);
            return config;
        } catch (error) {
            continue;
        }
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
        const response = await fetch('http://localhost:8000/api/saveConfig', {
            method: 'PUT',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
