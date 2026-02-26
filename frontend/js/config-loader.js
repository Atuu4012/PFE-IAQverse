/**
 * Gestionnaire de configuration pour IAQverse
 * Charge et gère la configuration depuis le backend
 */

const CONFIG_STORAGE_KEY = 'iaqverse_config';
const CONFIG_STORAGE_TTL_MS = 60_000; // 60 secondes

let config = null;
let configPromise = null;

/**
 * Charge la configuration depuis le backend
 * Utilise sessionStorage comme cache inter-pages (TTL 60s) pour éviter
 * de refetcher la config à chaque navigation.
 * @returns {Promise<Object>} La configuration chargée
 */
async function loadConfig() {
    // 1. Cache en mémoire (même page)
    if (config) return Promise.resolve(config);
    if (configPromise) return configPromise;

    // 2. Cache sessionStorage (inter-pages, dans la même session navigateur)
    try {
        const raw = sessionStorage.getItem(CONFIG_STORAGE_KEY);
        if (raw) {
            const { data, ts } = JSON.parse(raw);
            if (data && (Date.now() - ts) < CONFIG_STORAGE_TTL_MS) {
                config = data;
                console.debug('[config] Cache sessionStorage HIT');
                return Promise.resolve(config);
            }
        }
    } catch (_) { /* sessionStorage inaccessible (ex: mode privé strict) */ }

    // 3. Fetch réseau (une seule promesse globale pour éviter les doublons)
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

            const response = await fetch('/api/config', { headers });
            if (response.ok) {
                config = await response.json();
                // Persister dans sessionStorage pour les prochaines pages
                try {
                    sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ data: config, ts: Date.now() }));
                } catch (_) {}
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
        configPromise = null;
        throw error;
    }
}

async function saveConfig(updates = null) {
    // Invalider le cache sessionStorage lors d'une sauvegarde
    try { sessionStorage.removeItem(CONFIG_STORAGE_KEY); } catch (_) {}

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

        const result = await response.json();
        if (result && result.config) {
            config = result.config;
        }

        // Mettre à jour le cache sessionStorage avec la nouvelle config
        try {
            sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ data: config, ts: Date.now() }));
        } catch (_) {}

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
    // Synchroniser avec sessionStorage
    try {
        sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ data: newConfig, ts: Date.now() }));
    } catch (_) {}
}

// Export des fonctions
window.loadConfig = loadConfig;
window.saveConfig = saveConfig;
window.getConfig = getConfig;
window.setConfig = setConfig;

