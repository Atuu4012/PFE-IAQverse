/**
 * Configuration centralisée des endpoints API - IAQverse v2.0
 * Architecture avec reverse proxy Nginx - tous les appels passent par le même domaine
 */

// Utilise le même domaine (via Nginx reverse proxy) - pas de CORS
const API_BASE_URL = window.location.origin;

const API_ENDPOINTS = {
    // Health & Monitoring
    health: `${API_BASE_URL}/health`,
    
    // Mesures IAQ
    measurements: `${API_BASE_URL}/api/iaq/data`,
    measurementsRaw: `${API_BASE_URL}/api/iaq/data?raw=true`,
    
    // Ingestion
    ingest: `${API_BASE_URL}/api/ingest`,
    ingestIaq: `${API_BASE_URL}/api/ingest/iaq`,
    
    // Configuration
    config: `${API_BASE_URL}/config`,
    
    // Prédictions ML
    predictScore: `${API_BASE_URL}/api/predict/score`,
    preventiveActions: `${API_BASE_URL}/api/predict/preventive-actions`,
    
    // WebSocket (ws:// en dev, wss:// en prod)
    websocket: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
    websocketStats: `${API_BASE_URL}/ws/stats`,
};

// Helper function pour construire une URL avec paramètres
function buildApiUrl(endpoint, params = {}) {
    const url = new URL(endpoint);
    Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
            url.searchParams.append(key, params[key]);
        }
    });
    return url.toString();
}

// Note: IAQverse v2 utilise WebSocket pour les mises à jour temps réel
// Connectez-vous à ws://localhost:8000/ws pour recevoir les événements

// Export global
window.API_ENDPOINTS = API_ENDPOINTS;
window.buildApiUrl = buildApiUrl;
