/**
 * Gestionnaire des onglets d'enseignes et de pièces
 */

let activeEnseigne = null;
let activeRoom = null;

// Store room scores for alert highlighting: key = "enseigneId:roomId", value = score
const roomScores = new Map();

// Global threshold for alerting tabs (rooms & enseignes). Change this to tune sensitivity.
const ALERT_THRESHOLD = 81;

/**
 * Initialise le gestionnaire de tabs
 */
async function initTabsManager() {
    try {
        await loadConfig();
        const config = getConfig();

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
                data-room-id="${piece.id}">
            <img src="/assets/icons/${piece.type || 'room'}.png" alt="${piece.type || 'Pièce'}">
            ${escapeHtml(piece.nom)}
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

    // Si aucune pièce n'est active, activer la première
    if (!activeRoom && enseigne.pieces.length > 0) {
        // save=true is implied for this auto-select? 
        // Actually, if user switches enseigne, we auto-select room. Ideally we should save it.
        switchRoom(enseigne.pieces[0].id, true);
    }
}

/**
 * Change l'enseigne active
 * @param {string} enseigneId - L'ID de l'enseigne
 * @param {boolean} keepActiveRoom - Si true, ne pas réinitialiser activeRoom
 * @param {boolean} save - Si true, sauvegarde la config sur le backend
 */
function switchEnseigne(enseigneId, keepActiveRoom = false, save = true) {
    // Vérifier si on change vraiment d'enseigne
    const previousEnseigne = activeEnseigne;
    
    activeEnseigne = enseigneId;
    if (!keepActiveRoom) {
        activeRoom = null; // Réinitialiser la pièce active
    }
    
    if (save && typeof window.saveConfig === 'function') {
        // We only save the active enseigne here. Active room will be saved when switchRoom is called (or reset).
        // If we reset room, maybe we should save activeRoom: null? 
        // For now, let's just save the active Enseigne.
        window.saveConfig({ lieux: { active: enseigneId } });
        if (!keepActiveRoom && activeRoom === null) {
            // Optional: clear activeRoom in config? 
            // window.saveConfig({ lieux: { activeRoom: null } }); // If API supports it
        }
    }
    
    // Mettre à jour l'apparence des onglets d'enseignes
    document.querySelectorAll('.location-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.id === enseigneId);
    });

    // Mettre à jour les onglets des pièces pour l'enseigne sélectionnée
    renderRoomTabs(enseigneId);

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
    // Vérifier si on change vraiment de pièce
    const previousRoom = activeRoom;
    
    activeRoom = roomId;
    
    if (save && typeof window.saveConfig === 'function') {
        window.saveConfig({ lieux: { activeRoom: roomId } });
    }
    
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

            if (!enseigneName || !salleName || score === null) return;

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
            roomScores.set(key, score);
            // Refresh UI immediately
            if (typeof refreshAllTabAlerts === 'function') refreshAllTabAlerts();
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

/**
 * Background monitoring service for all rooms
 * Fetches data and calculates scores for all rooms periodically
 */
let monitoringInterval = null;

async function fetchRoomScore(enseigneNom, roomNom) {
    try {
        const url = `http://localhost:8000/api/iaq/data?enseigne=${encodeURIComponent(enseigneNom)}&salle=${encodeURIComponent(roomNom)}&hours=1`;
        
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
            return null;
        }
        
        const latest = data[data.length - 1];
        
        // Utiliser global_score de l'API backend
        if (typeof latest.global_score === 'number') {
            return latest.global_score;
        } else {
            // Retourner null pour éviter de bloquer le monitoring
            return null;
        }
    } catch (error) {
        console.error(`[tabs-manager] ❌ Error fetching score for ${enseigneNom}:${roomNom}:`, error);
    }
    return null;
}

async function updateAllRoomScores() {
    const config = getConfig();
    if (!config || !config.lieux || !config.lieux.enseignes) return;
    
    // Fetch scores for ALL rooms in parallel (including active one to ensure consistency)
    const promises = [];
    config.lieux.enseignes.forEach(enseigne => {
        if (Array.isArray(enseigne.pieces)) {
            enseigne.pieces.forEach(piece => {
                promises.push(
                    fetchRoomScore(enseigne.nom, piece.nom).then(score => ({
                        enseigneId: enseigne.id,
                        roomId: piece.id,
                        score
                    }))
                );
            });
        }
    });
    
    const results = await Promise.all(promises);
    
    // Update scores and tab alerts
    results.forEach(({ enseigneId, roomId, score }) => {
        if (score !== null) {
            const key = `${enseigneId}:${roomId}`;
            roomScores.set(key, score);
        }
    });
    
    // Always refresh UI to ensure consistency
    refreshAllTabAlerts();
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
    
    // Initial update
    updateAllRoomScores();
    
    // Update every 5 seconds (same frequency as charts.js updates)
    monitoringInterval = setInterval(updateAllRoomScores, 5000);
}

function stopBackgroundMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

// Start monitoring after initialization
document.addEventListener('DOMContentLoaded', () => {
    // Start monitoring as soon as tabs are initialized
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
