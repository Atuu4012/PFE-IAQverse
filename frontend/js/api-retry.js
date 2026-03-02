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
    if (!options.headers) {
        options.headers = {};
    }

    // Add Authorization header if available
    try {
        if (typeof getAuthToken === 'function') {
            const token = await getAuthToken();
            if (token) {
                if (options.headers instanceof Headers) {
                    options.headers.append('Authorization', `Bearer ${token}`);
                } else {
                    options.headers['Authorization'] = `Bearer ${token}`;
                }
            }
        }
    } catch (e) {
        console.warn('Error adding auth token:', e);
    }


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

// Export des fonctions
window.fetchWithRetry = fetchWithRetry;
