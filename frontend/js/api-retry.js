/**
 * Utilitaire de retry pour les appels API
 * Permet de réessayer automatiquement les requêtes en cas d'échec
 */

/**
 * Effectue une requête fetch avec retry automatique
 * @param {string} url - URL de la requête
 * @param {object} options - Options fetch
 * @param {number} maxRetries - Nombre maximum de tentatives
 * @param {number} retryDelay - Délai entre les tentatives (ms)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, retryDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            
            // Si la réponse est OK, la retourner
            if (response.ok) {
                return response;
            }
            
            // Si c'est une erreur 4xx, ne pas retry (erreur client)
            if (response.status >= 400 && response.status < 500) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Pour les erreurs 5xx, continuer le retry
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
            
        } catch (error) {
            lastError = error;
            
            // Si c'est la dernière tentative, lancer l'erreur
            if (attempt === maxRetries) {
                console.error(`[fetchWithRetry] All ${maxRetries + 1} attempts failed for ${url}`, lastError);
                throw lastError;
            }
            
            // Attendre avant de réessayer (backoff exponentiel)
            const delay = retryDelay * Math.pow(2, attempt);
            console.warn(`[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

/**
 * Wrapper pour les appels API avec gestion d'erreur et cache
 * @param {string} url - URL de l'API
 * @param {string} cacheKey - Clé de cache sessionStorage
 * @param {function} onSuccess - Callback en cas de succès
 * @param {function} onError - Callback en cas d'erreur
 * @param {object} options - Options supplémentaires
 */
async function apiCallWithCache(url, cacheKey, onSuccess, onError, options = {}) {
    const {
        maxRetries = 2,
        retryDelay = 1000,
        useCacheOnError = true,
        showCacheBadge = true
    } = options;
    
    try {
        const response = await fetchWithRetry(url, {}, maxRetries, retryDelay);
        const data = await response.json();
        
        // Sauvegarder dans le cache
        if (cacheKey) {
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
        }
        
        // Callback de succès
        if (onSuccess) {
            onSuccess(data, false); // false = pas depuis le cache
        }
        
        return data;
        
    } catch (error) {
        console.error(`[apiCallWithCache] Error for ${url}:`, error);
        
        // Essayer de restaurer depuis le cache
        if (useCacheOnError && cacheKey) {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const cachedData = JSON.parse(cached);
                    console.info(`[apiCallWithCache] Using cached data for ${cacheKey}`);
                    
                    if (onSuccess) {
                        onSuccess(cachedData, true); // true = depuis le cache
                    }
                    
                    return cachedData;
                } catch (parseError) {
                    console.error(`[apiCallWithCache] Failed to parse cached data:`, parseError);
                }
            }
        }
        
        // Callback d'erreur
        if (onError) {
            onError(error);
            return null; // Ne pas lancer d'exception si onError gère déjà l'erreur
        }
        
        throw error;
    }
}

// Export des fonctions
window.fetchWithRetry = fetchWithRetry;
window.apiCallWithCache = apiCallWithCache;
