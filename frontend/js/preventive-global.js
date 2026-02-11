/**
 * Construit le texte de raison traduit pour une action préventive
 */
function buildReasonText(action, t) {
    if (action.reason_key) {
        let reasonText = t(`digitalTwin.preventive.reasons.${action.reason_key}`) || action.reason_key;
        
        // Remplacer les paramètres dans le texte
        if (action.reason_params) {
            Object.keys(action.reason_params).forEach(key => {
                const placeholder = `{${key}}`;
                const value = action.reason_params[key];
                reasonText = reasonText.replace(new RegExp(placeholder, 'g'), value);
            });
        }
        
        return reasonText;
    }
    
    // Fallback vers l'ancien format si reason_key n'existe pas
    // Try to translate the raw reason text (backend may return a literal French sentence)
    const raw = action.reason || '';
    if (!raw) return '';
    // First try actionVerbs mapping (we populate literal backend phrases there), then preventive.reasons
    let translated = (t && t(`digitalTwin.actionVerbs.${raw}`)) || (t && t(`digitalTwin.preventive.reasons.${raw}`)) || raw;
    // Replace params if present
    if (action.reason_params) {
        Object.keys(action.reason_params).forEach(key => {
            const placeholder = `{${key}}`;
            const value = action.reason_params[key];
            translated = translated.replace(new RegExp(placeholder, 'g'), value);
        });
    }
    return translated;
}

/**
 * Récupère et affiche toutes les actions préventives pour toutes les pièces
 */
async function fetchAndDisplayGlobalPreventiveActions() {
    const container = document.getElementById('preventive-global-container');
    if (!container) return;
    
    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
    
    try {
        // Attendre que la config soit chargée
        await loadConfig();
        const cfg = getConfig();
        
        if (!cfg || !cfg.lieux || !cfg.lieux.enseignes) {
            console.error('[preventive-global] Configuration not available:', cfg);
            container.innerHTML = `<div class="preventive-loading">${t('digitalTwin.preventive.config_unavailable') || 'Configuration non disponible'}</div>`;
            return;
        }
        
        const allRoomActions = [];
        
        // Parcourir toutes les enseignes et toutes les pièces
        for (const enseigne of cfg.lieux.enseignes) {
            if (!enseigne.pieces || !Array.isArray(enseigne.pieces)) continue;
            
            for (const salle of enseigne.pieces) {
                const capteur_id = salle.capteurs?.[0] || salle.nom || 'Unknown';
                
                const actionsParams = new URLSearchParams({
                    enseigne: enseigne.nom || 'Unknown',
                    salle: salle.nom || 'Unknown',
                    capteur_id: capteur_id
                });
                
                const scoreParams = new URLSearchParams({
                    enseigne: enseigne.nom || 'Unknown',
                    salle: salle.nom || 'Unknown'
                });
                
                try {
                    // Récupérer les actions préventives depuis l'API
                    const actionsParams = new URLSearchParams({
                        enseigne: enseigne.nom || 'Unknown',
                        salle: salle.nom || 'Unknown'
                    });
                    
                    const actionsResponse = await fetchWithRetry(`${API_ENDPOINTS.preventiveActions}?${actionsParams}`, {}, 1);
                    // Defensive: some responses may be HTML error pages (502/Bad Gateway from proxy)
                    // Read as text first and try to parse JSON to avoid Uncaught SyntaxError
                    let actionsData = null;
                    const rawText = await actionsResponse.text();
                    if (!actionsResponse.ok) {
                        console.error(`[preventive-global] HTTP ${actionsResponse.status} fetching actions for ${enseigne.nom}/${salle.nom}:`, rawText.slice(0, 300));
                        // create a placeholder error object so downstream code won't crash
                        actionsData = { error: `HTTP ${actionsResponse.status}` };
                    } else {
                        try {
                            actionsData = JSON.parse(rawText);
                        } catch (e) {
                            console.error(`[preventive-global] Invalid JSON response for ${enseigne.nom}/${salle.nom}:`, rawText.slice(0, 500));
                            actionsData = { error: 'invalid_json' };
                        }
                    }
                    
                    // Les actions préventives incluent maintenant le score prédit
                    if (!actionsData.error && actionsData.actions && actionsData.actions.length > 0) {
                        allRoomActions.push({
                            enseigne: enseigne.nom,
                            salle: salle.nom,
                            actions: actionsData.actions,
                            score: actionsData.predicted_score || null
                        });
                    }
                } catch (error) {
                    console.error(`[preventive-global] Error fetching actions for ${enseigne.nom}/${salle.nom}:`, error);
                }
            }
        }
        
        displayGlobalPreventiveActions(allRoomActions);
        
    } catch (error) {
        console.error('[preventive-global] Error fetching global actions:', error);
        const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
        container.innerHTML = `<div class="preventive-info" style="color: #666;">
            ℹ️ ${t('digitalTwin.preventive.loading') || 'Chargement des prédictions...'}<br>
            <small>Les données seront disponibles dans quelques instants</small>
        </div>`;
    }
}

/**
 * Affiche les actions préventives globales en carrousel
 */
function displayGlobalPreventiveActions(allRoomActions) {
    const container = document.getElementById('preventive-global-container');
    if (!container) return;
    
    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
    
    if (!allRoomActions || allRoomActions.length === 0) {
        container.innerHTML = `
            <div class="preventive-all-good">
                ${t('digitalTwin.preventive.no_actions_global') || 'Aucune action préventive nécessaire'}
            </div>
        `;
        return;
    }
    
    const deviceI18nMap = {
        'window': 'window',
        'door': 'door',
        'ventilation': 'ventilation',
        'radiator': 'radiator',
        'air_purifier': 'air_purifier'
    };
    
    const actionI18nMap = {
        'open': 'open',
        'close': 'close',
        'turn_on': 'turn_on',
        'turn_off': 'turn_off',
        'increase': 'increase',
        'decrease': 'decrease'
    };
    
    // Créer le carrousel
    let html = '<div class="preventive-carousel">';
    
    allRoomActions.forEach((roomData, index) => {
        const actionsCount = roomData.actions.length;
        const score = roomData.score !== null && roomData.score !== undefined ? Math.round(roomData.score) : null;
        
        html += `
            <div class="preventive-room-card">
                <div class="preventive-room-header">
                    <div class="preventive-room-title-row">
                        <div class="preventive-room-title">${roomData.salle}</div>
                        ${score !== null ? `<div class="preventive-room-score">${score}</div>` : ''}
                    </div>
                    <div class="preventive-room-location">${roomData.enseigne}</div>
                    <div class="preventive-room-count">
                            ${actionsCount === 0 ? (t && t('digitalTwin.actionCount.zero')) || 'No actions' : 
                            actionsCount === 1 ? (t && t('digitalTwin.actionCount.one')) || '1 action' : 
                            ((t && t('digitalTwin.actionCount.multiple')) || '{{count}} actions').replace('{{count}}', actionsCount)}
                    </div>
                </div>
                <div class="preventive-room-actions">
        `;
        
        roomData.actions.forEach((action, actionIndex) => {
            const deviceKey = deviceI18nMap[action.device] || action.device;
            const deviceName = (t && t(`digitalTwin.sample.${deviceKey}.subject`)) || action.device;
            
            const actionKey = actionI18nMap[action.action] || action.action;
            const actionVerb = (t && t(`digitalTwin.actionVerbs.${actionKey}`)) || action.action;
            
            const priorityLabel = t(`digitalTwin.preventive.priorities.${action.priority}`) || {
                'high': 'Urgent',
                'medium': 'Recommandé',
                'low': 'Optionnel'
            }[action.priority] || action.priority;
            
            const actionId = `action-${index}-${actionIndex}`;
            
            html += `
                <div class="preventive-action-item priority-${action.priority}" id="${actionId}">
                    <div class="preventive-action-header" onclick="toggleAction('${actionId}')">
                        <span class="preventive-action-device">${deviceName}</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="preventive-action-priority">${priorityLabel}</span>
                            <span class="preventive-action-toggle">▼</span>
                        </div>
                    </div>
                        <div class="preventive-action-details">
                        <div class="preventive-action-verb">${actionVerb}</div>
                        <div class="preventive-action-reason">${buildReasonText(action, t)}</div>
                        <div class="preventive-action-values">
                            <div>
                                <span class="preventive-value-label">${action.parameter} :</span>
                            </div>
                            <div class="preventive-value-change">
                                <span class="preventive-value-current">${action.current_value} ${action.unit}</span>
                                <span class="preventive-value-arrow">${t('digitalTwin.preventive.arrow') || '→'}</span>
                                <span class="preventive-value-predicted">${action.predicted_value || action.current_value} ${action.unit}</span>
                                ${action.change_percent !== undefined ? 
                                    `<span class="preventive-value-percent ${action.change_percent > 0 ? 'increasing' : 'decreasing'}">
                                        (${action.change_percent > 0 ? '+' : ''}${action.change_percent.toFixed(1)}%)
                                    </span>` : ''}
                            </div>
                            ${action.trend ? `<div class="preventive-value-trend">
                                <span class="trend-indicator trend-${action.trend}">
                                    ${action.trend === 'increasing' ? (t && t('digitalTwin.trend.increasing')) || 'En augmentation' : action.trend === 'decreasing' ? (t && t('digitalTwin.trend.decreasing')) || 'En diminution' : (t && t('digitalTwin.trend.stable')) || 'Stable'}
                                </span>
                            </div>` : ''}
                            ${action.forecast_minutes ? `<div class="preventive-value-forecast">
                                <span class="forecast-time">${((t && t('digitalTwin.preventive.forecast')) || 'Prévision à {minutes} minutes').replace('{minutes}', action.forecast_minutes)}</span>
                            </div>` : ''}
                            ${action.is_ml_action ? `<div class="preventive-ml-badge">
                                <span class="ml-indicator">${(t && t('digitalTwin.preventive.mlPrediction')) || 'Prédiction ML'}</span>
                            </div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

/**
 * Toggle l'état d'une carte de pièce (expand/collapse)
 */
function toggleRoomCard(index) {
    const card = document.getElementById(`room-card-${index}`);
    if (card) {
        card.classList.toggle('expanded');
    }
}

/**
 * Toggle l'état d'une action individuelle (expand/collapse)
 */
function toggleAction(actionId) {
    const clickedAction = document.getElementById(actionId);
    if (!clickedAction) return;
    
    const isExpanding = !clickedAction.classList.contains('expanded');
    
    // Fermer toutes les autres actions dans la même carte
    const card = clickedAction.closest('.preventive-room-card');
    if (card && isExpanding) {
        const allActions = card.querySelectorAll('.preventive-action-item.expanded');
        allActions.forEach(action => {
            if (action.id !== actionId) {
                action.classList.remove('expanded');
            }
        });
    }
    
    // Toggle l'action cliquée
    clickedAction.classList.toggle('expanded');
}

// Rendre les fonctions accessibles globalement
window.toggleRoomCard = toggleRoomCard;
window.toggleAction = toggleAction;

// Initialiser au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
    try {
        fetchAndDisplayGlobalPreventiveActions();
        // Rafraîchir toutes les minutes, synchronisé
        const now = new Date();
        const secondsUntilNextMinute = 60 - now.getSeconds();
        const initialDelay = secondsUntilNextMinute * 1000;
        setTimeout(() => {
            fetchAndDisplayGlobalPreventiveActions();
            setInterval(fetchAndDisplayGlobalPreventiveActions, 30000);
        }, initialDelay);
    } catch (e) {
        console.error('[preventive-global] Error in DOMContentLoaded:', e);
    }
});

// Rafraîchir lors du changement de langue
window.addEventListener('language-changed', () => {
    try { fetchAndDisplayGlobalPreventiveActions(); } catch (e) {}
});
