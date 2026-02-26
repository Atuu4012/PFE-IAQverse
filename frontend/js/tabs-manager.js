/**
 * Gestionnaire des onglets d'enseignes et de pièces
 */

let activeEnseigne = null;
let activeRoom = null;

// Store room scores for alert highlighting: key = "enseigneId:roomId", value = score
const roomScores = new Map();
// Store occupant counts per room: key = "enseigneId:roomId", value = count
const roomOccupants = new Map();

// Global threshold for alerting tabs (rooms & enseignes). Change this to tune sensitivity.
const ALERT_THRESHOLD = 81;

function normalizeOccupants(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return Math.max(0, Math.round(value));
}

function setRoomOccupants(enseigneId, roomId, count) {
    if (!enseigneId || !roomId) return;
    const key = `${enseigneId}:${roomId}`;
    if (count === null) {
        roomOccupants.delete(key);
    } else {
        roomOccupants.set(key, count);
    }
}

function readCachedOccupants(roomId) {
    if (!roomId) return null;
    try {
        const cached = localStorage.getItem('cached_occupants_' + roomId);
        if (cached === null) return null;
        const parsed = parseInt(cached, 10);
        return Number.isNaN(parsed) ? null : parsed;
    } catch (e) {
        return null;
    }
}

function updateBadgeElement(badge, count, title) {
    if (!badge) return;
    if (typeof count === 'number') {
        badge.textContent = String(count);
        badge.style.display = 'flex';
        if (title) badge.title = title;
    } else {
        badge.style.display = 'none';
    }
}

function getEnseigneOccupantTotal(enseigne) {
    let total = 0;
    let hasData = false;

    (enseigne.pieces || []).forEach(piece => {
        const key = `${enseigne.id}:${piece.id}`;
        const count = roomOccupants.get(key);
        if (typeof count === 'number') {
            total += count;
            hasData = true;
        }
    });

    return { total, hasData };
}

function refreshAllOccupantBadges() {
    const config = getConfig();
    if (!config || !config.lieux || !config.lieux.enseignes) return;

    document.querySelectorAll('.room-tab[data-room-id]').forEach(roomTab => {
        const roomId = roomTab.getAttribute('data-room-id');
        const enseigneId = roomTab.getAttribute('data-enseigne-id') || activeEnseigne;
        const key = `${enseigneId}:${roomId}`;
        let count = roomOccupants.has(key) ? roomOccupants.get(key) : null;
        if (count === null && roomId === activeRoom) {
            const cached = readCachedOccupants(roomId);
            if (cached !== null) count = cached;
        }

        const badge = roomTab.querySelector('.room-occupant-badge');
        const title = (typeof count === 'number')
            ? `${count} personne${count > 1 ? 's' : ''} dans la piece`
            : '';
        updateBadgeElement(badge, count, title);
    });

    config.lieux.enseignes.forEach(enseigne => {
        const badge = document.querySelector(
            `.location-occupant-badge[data-enseigne-id="${enseigne.id}"]`
        );
        const { total, hasData } = getEnseigneOccupantTotal(enseigne);
        const count = hasData ? total : null;
        const title = (typeof count === 'number')
            ? `${count} personne${count > 1 ? 's' : ''} au total`
            : '';
        updateBadgeElement(badge, count, title);
    });
}

/**
 * Initialise le gestionnaire de tabs
 */
async function initTabsManager() {
    try {
        const config = await window.loadConfig();
        if (!config || !config.lieux || !config.lieux.enseignes) {
            console.error('Pas d\'enseignes trouvées dans la configuration');
            return;
        }

        renderLocationTabs();
        // Setup WebSocket listeners so tab alerts update instantly on new measurements
        try {
            setupWsListeners();
        } catch (e) {
            console.warn('[tabs-manager] setupWsListeners failed:', e);
        }

        // Removed localStorage. Using config.lieux.active / config.lieux.activeRoom instead.
        const configActiveEnseigne = config.lieux.active;
        const configActiveRoom = config.lieux.activeRoom;

        if (config.lieux.enseignes.length > 0) {
            // Locate the enseigne from config or default to first
            let defaultEnseigne = configActiveEnseigne;
            // Verify it exists in the list
            if (!config.lieux.enseignes.find(e => e.id === defaultEnseigne)) {
                defaultEnseigne = config.lieux.enseignes[0].id;
            }

            // Définir activeRoom s'il est valide pour cette enseigne
            const enseigne = config.lieux.enseignes.find(e => e.id === defaultEnseigne);
            if (configActiveRoom && enseigne?.pieces?.some(p => p.id === configActiveRoom)) {
                activeRoom = configActiveRoom;
            }

            // Passer keepActiveRoom=true et save=false (init)
            switchEnseigne(defaultEnseigne, activeRoom !== null, false);

            // Si activeRoom a été défini, émettre roomChanged explicitement
            if (activeRoom) {
                document.dispatchEvent(new CustomEvent('roomChanged', { 
                    detail: { roomId: activeRoom, enseigneId: defaultEnseigne } 
                }));
            }
        }
    } catch (error) {
        console.error('Erreur lors de l\'initialisation des tabs:', error);
    }
}

/**
 * Affiche les onglets des enseignes
 */
function renderLocationTabs() {
    const tabsContainer = document.getElementById('location-tabs');
    if (!tabsContainer) return;

    const config = getConfig();
    
    tabsContainer.innerHTML = config.lieux.enseignes.map(enseigne => `
        <div class="location-tab${enseigne.id === activeEnseigne ? ' active' : ''}" 
                onclick="switchEnseigne('${enseigne.id}')"
                data-id="${enseigne.id}">
            <img src="/assets/icons/building.png" alt="Enseigne">
            ${escapeHtml(enseigne.nom)}
            <span class="location-occupant-badge" data-enseigne-id="${enseigne.id}" style="display: none;"></span>
        </div>
    `).join('');
    
    // Reapply alerts to all enseigne tabs based on stored scores
    config.lieux.enseignes.forEach(ens => {
        let enseigneHasAlert = false;
        for (const [storedKey, storedScore] of roomScores.entries()) {
            if (storedKey.startsWith(ens.id + ':') && storedScore < ALERT_THRESHOLD) {
                enseigneHasAlert = true;
                break;
            }
        }
        const enseigneTab = document.querySelector(`.location-tab[data-id="${ens.id}"]`);
        if (enseigneTab) {
            if (enseigneHasAlert) {
                enseigneTab.classList.add('has-alert');
            } else {
                enseigneTab.classList.remove('has-alert');
            }
        }
    });

    refreshAllOccupantBadges();
}

/**
 * Affiche les onglets des pièces pour une enseigne
 * @param {string} enseigneId - L'ID de l'enseigne
 */
function renderRoomTabs(enseigneId) {
    const roomTabs = document.getElementById('room-tabs');
    if (!roomTabs) return;

    const config = getConfig();
    const enseigne = config.lieux.enseignes.find(e => e.id === enseigneId);
    
    if (!enseigne || !Array.isArray(enseigne.pieces)) {
        roomTabs.innerHTML = '<div class="room-tab">Aucune pièce</div>';
        return;
    }

    roomTabs.innerHTML = enseigne.pieces.map(piece => `
        <div class="room-tab${piece.id === activeRoom ? ' active' : ''}" 
                onclick="switchRoom('${piece.id}')"
                data-id="${piece.id}"
                data-room-id="${piece.id}"
                data-enseigne-id="${enseigneId}">
            <img src="/assets/icons/${piece.type || 'room'}.png" alt="${piece.type || 'Pièce'}">
            ${escapeHtml(piece.nom)}
            <span class="room-occupant-badge" id="room-badge-${piece.id}" style="display: none;" onclick="event.stopPropagation()"></span>
        </div>
    `).join('');

    // Reapply alerts to all room tabs based on stored scores
    enseigne.pieces.forEach(piece => {
        const pieceKey = `${enseigneId}:${piece.id}`;
        const pieceScore = roomScores.get(pieceKey);
        if (pieceScore !== undefined) {
            const roomTab = document.querySelector(`.room-tab[data-room-id="${piece.id}"]`);
            if (roomTab) {
                if (pieceScore < ALERT_THRESHOLD) {
                    roomTab.classList.add('has-alert');
                } else {
                    roomTab.classList.remove('has-alert');
                }
            }
        }
    });

    // Si aucune pièce n'est active, activer la première sans save (on sauvegardera tout dans switchEnseigne)
    if (!activeRoom && enseigne.pieces.length > 0) {
        switchRoom(enseigne.pieces[0].id, false);
    }

    refreshAllOccupantBadges();
}

/**
 * Change l'enseigne active
 * @param {string} enseigneId - L'ID de l'enseigne
 * @param {boolean} keepActiveRoom - Si true, ne pas réinitialiser activeRoom
 * @param {boolean} save - Si true, sauvegarde la config sur le backend
 */
function switchEnseigne(enseigneId, keepActiveRoom = false, save = true) {
    activeEnseigne = enseigneId;
    if (!keepActiveRoom) {
        activeRoom = null; // Réinitialiser la pièce active
    }
    
    if (save && typeof window.saveConfig === 'function') {
        // On sauvegarde enseigne ET pièce active en un seul PUT
        window.saveConfig({ lieux: { active: enseigneId, activeRoom: activeRoom || null } });
    }
    
    // Mettre à jour l'apparence des onglets d'enseignes
    document.querySelectorAll('.location-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.id === enseigneId);
    });

    // Mettre à jour les onglets des pièces pour l'enseigne sélectionnée
    renderRoomTabs(enseigneId);

    refreshAllOccupantBadges();

    // Émettre un événement personnalisé pour notifier le changement
    document.dispatchEvent(new CustomEvent('enseigneChanged', { 
        detail: { enseigneId } 
    }));
}

/**
 * Change la pièce active
 * @param {string} roomId - L'ID de la pièce
 * @param {boolean} save - Si true, sauvegarde la config sur le backend
 */
function switchRoom(roomId, save = true) {
    activeRoom = roomId;
    
    if (save && typeof window.saveConfig === 'function') {
        window.saveConfig({ lieux: { activeRoom: roomId } });
    }
    
    // Sauvegarder aussi dans sessionStorage pour occupants-display.js
    sessionStorage.setItem('activePieceId', roomId);
    sessionStorage.setItem('activeEnseigneId', activeEnseigne);
    
    // Mettre à jour l'apparence des onglets
    document.querySelectorAll('.room-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.id === roomId);
    });

    // Émettre un événement personnalisé pour notifier le changement
    document.dispatchEvent(new CustomEvent('roomChanged', { 
        detail: { roomId, enseigneId: activeEnseigne } 
    }));
}

/**
 * Obtient l'enseigne active
 * @returns {string} L'ID de l'enseigne active
 */
function getActiveEnseigne() {
    return activeEnseigne;
}

/**
 * Obtient la pièce active
 * @returns {string} L'ID de la pièce active
 */
function getActiveRoom() {
    return activeRoom;
}

/**
 * Enregistre un listener WebSocket pour les nouveaux messages 'measurement'
 * et met à jour immédiatement les alertes d'onglets en utilisant le score
 */
function setupWsListeners() {
    if (typeof window === 'undefined' || !window.wsManager || typeof window.wsManager.on !== 'function') return;

    // Prevent double registration: try to add only once
    if (window.__tabsManagerWsRegistered) return;
    window.__tabsManagerWsRegistered = true;

    window.wsManager.on('measurements', (msg) => {
        try {
            // msg should contain enseigne, salle and global_score (added server-side)
            const enseigneName = msg.enseigne || msg.enseigneName || msg.building;
            const salleName = msg.salle || msg.room || msg.salleName;
            const score = (typeof msg.global_score === 'number') ? msg.global_score : null;
            const occupants = normalizeOccupants(msg.occupants);

            if (!enseigneName || !salleName) return;

            const config = getConfig();
            if (!config || !config.lieux || !Array.isArray(config.lieux.enseignes)) return;

            const enseigne = config.lieux.enseignes.find(e => e.nom === enseigneName || e.id === enseigneName || (e.nom && e.nom.toLowerCase() === String(enseigneName).toLowerCase()));
            if (!enseigne) return;

            let piece = (enseigne.pieces || []).find(p => p.nom === salleName || p.id === salleName);
            if (!piece) {
                piece = (enseigne.pieces || []).find(p => p.nom && p.nom.toLowerCase() === String(salleName).toLowerCase());
            }
            if (!piece) return;

            const key = `${enseigne.id}:${piece.id}`;
            if (score !== null) {
                roomScores.set(key, score);
                if (typeof refreshAllTabAlerts === 'function') refreshAllTabAlerts();
            }
            if (occupants !== null) {
                roomOccupants.set(key, occupants);
                refreshAllOccupantBadges();
            }
        } catch (err) {
            console.error('[tabs-manager] Error handling WS measurement:', err);
        }
    });
}

// Initialiser au chargement de la page
document.addEventListener('DOMContentLoaded', initTabsManager);

// Export des fonctions
window.switchEnseigne = switchEnseigne;
window.switchRoom = switchRoom;
window.getActiveEnseigne = getActiveEnseigne;
window.getActiveRoom = getActiveRoom;
window.renderLocationTabs = renderLocationTabs;
window.renderRoomTabs = renderRoomTabs;
window.refreshAllOccupantBadges = refreshAllOccupantBadges;

/**
 * Background monitoring service for all rooms
 * Fetches data and calculates scores for all rooms periodically
 */
let monitoringInterval = null;

async function fetchRoomMetrics(enseigneNom, roomNom) {
    try {
        const baseUrl = (window.API_ENDPOINTS && window.API_ENDPOINTS.measurements)
            ? window.API_ENDPOINTS.measurements
            : "/api/iaq/data";
        const url = `${baseUrl}?enseigne=${encodeURIComponent(enseigneNom)}&salle=${encodeURIComponent(roomNom)}&hours=1`;
        
        const response = await fetchWithRetry(url, {}, 1);
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
            return { score: null, occupants: null };
        }
        
        const latest = data[data.length - 1];
        
        const score = (typeof latest.global_score === 'number') ? latest.global_score : null;
        const occupants = normalizeOccupants(latest.occupants);
        return { score, occupants };
    } catch (error) {
        console.error(`[tabs-manager] ❌ Error fetching score for ${enseigneNom}:${roomNom}:`, error);
    }
    return { score: null, occupants: null };
}

async function updateAllRoomScores() {
    const config = getConfig();
    if (!config || !config.lieux || !config.lieux.enseignes) return;

    const currentEnseigneId = activeEnseigne || config.lieux.active || null;
    const currentRoomId = activeRoom || config.lieux.activeRoom || null;
    
    // Fetch scores for all rooms except active one to avoid duplicate fetch
    // with the main page modules already loading active room data.
    const promises = [];
    config.lieux.enseignes.forEach(enseigne => {
        if (Array.isArray(enseigne.pieces)) {
            enseigne.pieces.forEach(piece => {
                if (enseigne.id === currentEnseigneId && piece.id === currentRoomId) {
                    return;
                }
                promises.push(
                    fetchRoomMetrics(enseigne.nom, piece.nom).then(({ score, occupants }) => ({
                        enseigneId: enseigne.id,
                        roomId: piece.id,
                        score,
                        occupants
                    }))
                );
            });
        }
    });
    
    const results = await Promise.all(promises);
    
    // Update scores and tab alerts
    results.forEach(({ enseigneId, roomId, score, occupants }) => {
        if (score !== null) {
            const key = `${enseigneId}:${roomId}`;
            roomScores.set(key, score);
        }
        if (occupants !== null) {
            const key = `${enseigneId}:${roomId}`;
            roomOccupants.set(key, occupants);
        }
    });
    
    // Always refresh UI to ensure consistency
    refreshAllTabAlerts();
    refreshAllOccupantBadges();
}

function refreshAllTabAlerts() {
    const config = getConfig();
    if (!config || !config.lieux || !config.lieux.enseignes) return;
    
    // Update ALL room tabs that exist in the DOM (not just for active enseigne)
    document.querySelectorAll('.room-tab[data-room-id]').forEach(roomTab => {
        const roomId = roomTab.getAttribute('data-room-id');
        // Find which enseigne this room belongs to by checking all enseignes
        let roomScore = null;
        for (const [key, score] of roomScores.entries()) {
            if (key.endsWith(':' + roomId)) {
                roomScore = score;
                break;
            }
        }
        
        if (roomScore !== null && roomScore !== undefined) {
            if (roomScore < ALERT_THRESHOLD) {
                roomTab.classList.add('has-alert');
            } else {
                roomTab.classList.remove('has-alert');
            }
        }
    });
    
    // Update all enseigne tabs
    config.lieux.enseignes.forEach(ens => {
        let enseigneHasAlert = false;
        for (const [storedKey, storedScore] of roomScores.entries()) {
            if (storedKey.startsWith(ens.id + ':') && storedScore < ALERT_THRESHOLD) {
                enseigneHasAlert = true;
                break;
            }
        }
        const enseigneTab = document.querySelector(`.location-tab[data-id="${ens.id}"]`);
        if (enseigneTab) {
            if (enseigneHasAlert) {
                enseigneTab.classList.add('has-alert');
            } else {
                enseigneTab.classList.remove('has-alert');
            }
        }
    });
}

function startBackgroundMonitoring() {
    if (monitoringInterval) return; // Already running

    // Attendre que le contexte actif soit initialisé pour pouvoir ignorer
    // correctement la salle active dans updateAllRoomScores.
    if (!activeEnseigne || !activeRoom) {
        setTimeout(startBackgroundMonitoring, 300);
        return;
    }
    
    // Single initial fetch to seed tab alerts before WebSocket data arrives
    updateAllRoomScores();
    
    // No polling interval needed: WebSocket (setupWsListeners) handles real-time updates
}

function stopBackgroundMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

// Start monitoring after initialization
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(startBackgroundMonitoring, 500);
});

// Stop monitoring when page is hidden/unloaded
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopBackgroundMonitoring();
        } else {
            startBackgroundMonitoring();
        }
    });
}

window.startBackgroundMonitoring = startBackgroundMonitoring;
window.stopBackgroundMonitoring = stopBackgroundMonitoring;

/**
 * Updates tab alert styling based on room score
 * @param {number} score - The room IAQ score (0-100)
 */
window.updateTabAlerts = function(score) {
    if (!activeEnseigne || !activeRoom) return;
    
    const key = `${activeEnseigne}:${activeRoom}`;
    roomScores.set(key, score);
    
    // Refresh all tab alerts (will be updated by background service too)
    if (typeof refreshAllTabAlerts === 'function') {
        refreshAllTabAlerts();
    }
};

window.updateRoomOccupants = function(enseigneId, roomId, occupants) {
    const count = normalizeOccupants(occupants);
    if (count === null) return;
    setRoomOccupants(enseigneId, roomId, count);
    refreshAllOccupantBadges();
};
