/**
 * Gestion de l'affichage du nombre d'occupants
 */

// Variable pour stocker le dernier nombre d'occupants connu
let lastOccupantsCount = null;

// Fonction pour mettre à jour l'affichage du nombre d'occupants
function updateOccupantsDisplay(occupantsCount) {
    // Convertir en nombre entier
    const count = occupantsCount !== undefined && occupantsCount !== null ? Math.round(occupantsCount) : null;
    
    // Ne mettre à jour que si la valeur a changé
    if (count === lastOccupantsCount) return;
    lastOccupantsCount = count;
    
    // Sauvegarder dans le cache pour réduire la latence au prochain chargement
    try {
        const activePiece = sessionStorage.getItem('activePieceId') || localStorage.getItem('activeRoom');
        if (activePiece && count !== null) {
            localStorage.setItem('cached_occupants_' + activePiece, count);
        }
    } catch (e) {}
    
    // Pour la page index.html
    const occupantsBadge = document.getElementById('occupants-badge');
    const occupantsCountEl = document.getElementById('occupants-count');
    
    if (occupantsBadge && occupantsCountEl) {
        if (count !== null && count >= 0) {
            occupantsCountEl.textContent = count;
            occupantsBadge.style.display = 'flex';
            
            // Animation d'apparition
            if (occupantsBadge.style.opacity === '0' || !occupantsBadge.style.opacity) {
                occupantsBadge.style.opacity = '0';
                occupantsBadge.style.transform = 'translateY(-50%) scale(0.8)';
                
                requestAnimationFrame(() => {
                    occupantsBadge.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    occupantsBadge.style.opacity = '1';
                    occupantsBadge.style.transform = 'translateY(-50%) scale(1)';
                });
            }
        } else {
            occupantsBadge.style.display = 'none';
        }
    }
    
    // Pour la page digital-twin.html
    const occupantsBadgeTwin = document.getElementById('occupants-badge-twin');
    const occupantsCountTwin = document.getElementById('occupants-count-twin');
    
    if (occupantsBadgeTwin && occupantsCountTwin) {
        if (count !== null && count >= 0) {
            occupantsCountTwin.textContent = count;
            occupantsBadgeTwin.style.display = 'flex';
            
            // Animation d'apparition
            if (occupantsBadgeTwin.style.opacity === '0' || !occupantsBadgeTwin.style.opacity) {
                occupantsBadgeTwin.style.opacity = '0';
                occupantsBadgeTwin.style.transform = 'scale(0.8)';
                
                requestAnimationFrame(() => {
                    occupantsBadgeTwin.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    occupantsBadgeTwin.style.opacity = '1';
                    occupantsBadgeTwin.style.transform = 'scale(1)';
                });
            }
        } else {
            occupantsBadgeTwin.style.display = 'none';
        }
    }
}

// Fonction pour restaurer immédiatement la valeur en cache (anti-latence)
function restoreCachedOccupants() {
    try {
        const activePiece = sessionStorage.getItem('activePieceId') || localStorage.getItem('activeRoom');
        if (activePiece) {
            const cached = localStorage.getItem('cached_occupants_' + activePiece);
            if (cached !== null) {
                updateOccupantsDisplay(parseInt(cached, 10));
            }
        }
    } catch(e) {}
}

// Fonction pour récupérer le nombre d'occupants depuis l'API
async function fetchOccupantsFromAPI() {
    try {
        // Récupérer l'enseigne et la pièce actives
        const config = window.getConfig ? window.getConfig() : await window.loadConfig();
        
        if (!config || !config.lieux || !config.lieux.enseignes) {
            return;
        }
        
        const activeEnseigne = sessionStorage.getItem('activeEnseigneId') || localStorage.getItem('activeEnseigne') || config.lieux.active;
        const activePiece = sessionStorage.getItem('activePieceId') || localStorage.getItem('activeRoom');
        
        if (!activePiece || !activeEnseigne) {
            return;
        }
        
        // Trouver les noms de l'enseigne et de la pièce
        let enseigneNom = '';
        let pieceNom = '';
        
        for (const enseigne of config.lieux.enseignes) {
            if (enseigne.id === activeEnseigne) {
                enseigneNom = enseigne.nom;
                for (const piece of enseigne.pieces || []) {
                    if (piece.id === activePiece) {
                        pieceNom = piece.nom;
                        break;
                    }
                }
                break;
            }
        }
        
        if (!enseigneNom || !pieceNom) {
            return;
        }
        
        // Récupérer les dernières données depuis l'API
        const headers = { 'ngrok-skip-browser-warning': 'true' };
        try {
            if (typeof getAuthToken === 'function') {
                const token = await getAuthToken();
                if (token) headers['Authorization'] = `Bearer ${token}`;
            }
        } catch(e) {}

        const response = await fetch(`/api/iaq/data?enseigne=${encodeURIComponent(enseigneNom)}&salle=${encodeURIComponent(pieceNom)}&hours=1`, { headers });
        
        if (!response.ok) {
            console.warn('[occupants-display] Erreur lors de la récupération des données');
            return;
        }
        
        const dataArray = await response.json();
        
        // Prendre la dernière mesure
        if (dataArray && dataArray.length > 0) {
            const latestData = dataArray[dataArray.length - 1];
            if (typeof latestData.occupants !== 'undefined') {
                updateOccupantsDisplay(latestData.occupants);
            }
        }
    } catch (error) {
        console.error('[occupants-display] Erreur lors de la récupération des occupants:', error);
    }
}

// Écouter les messages WebSocket pour les mises à jour en temps réel
function setupOccupantsWebSocket() {
    // Écouter les événements de mesure WebSocket si le WebSocket manager existe
    if (typeof window.wsManager !== 'undefined' && window.wsManager) {
        window.wsManager.on('measurements', (data) => {
            if (data && typeof data.occupants !== 'undefined') {
                updateOccupantsDisplay(data.occupants);
            }
        });
    }
    
    // Fallback: écouter aussi l'événement DOM personnalisé
    document.addEventListener('measurementReceived', (event) => {
        const data = event.detail;
        if (data && typeof data.occupants !== 'undefined') {
            updateOccupantsDisplay(data.occupants);
        }
    });
}

// Initialiser au chargement de la page
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        restoreCachedOccupants();
        // Attendre que la config et les onglets soient chargés
        setTimeout(() => {
            setupOccupantsWebSocket();
            fetchOccupantsFromAPI();
        }, 100);
    });
} else {
    restoreCachedOccupants();
    // Si déjà chargé, initialiser immédiatement
    setTimeout(() => {
        setupOccupantsWebSocket();
        fetchOccupantsFromAPI();
    }, 100);
}

// Écouter les changements de pièce (via les onglets) - mise à jour immédiate
window.addEventListener('roomChanged', () => {
    restoreCachedOccupants();
    fetchOccupantsFromAPI();
});

// Écouter aussi les clics sur les onglets de pièces - mise à jour immédiate
document.addEventListener('click', (e) => {
    if (e.target.closest('.room-tab')) {
        setTimeout(fetchOccupantsFromAPI, 50);
    }
});

// Rafraîchir périodiquement (toutes les 30 secondes comme backup)
setInterval(fetchOccupantsFromAPI, 30000);

// Export pour utilisation externe
if (typeof window !== 'undefined') {
    window.updateOccupantsDisplay = updateOccupantsDisplay;
    window.fetchOccupantsFromAPI = fetchOccupantsFromAPI;
}
