/**
 * Script spécifique pour la page Digital Twin
 */

let currentDetailsSubject = null;
/**
 * Affiche les détails d'une alerte
 * @param {string} sujet - Le sujet de l'alerte (ex. Fenêtre, Ventilation, etc.)
 * @param {object} detail - Détails optionnels { issues: [{code,name,unit,severity,value,direction,threshold}], actionKey }
 * @param {boolean} forceRefresh - Si true, force la mise à jour sans toggle
 */
function showDetails(sujet, detail, forceRefresh = false) {
    const panel = document.getElementById("details-panel");
    const list = document.getElementById("details-list");
    if (!panel || !list) return;
    // Toggle: si on reclique sur le même sujet, on masque les détails (sauf si forceRefresh)
    if (!forceRefresh && !panel.classList.contains('hidden') && currentDetailsSubject === sujet) {
        panel.classList.add('hidden');
        list.innerHTML = '';
        currentDetailsSubject = null;
        return;
    }

    panel.classList.remove("hidden");
    list.innerHTML = "";
    currentDetailsSubject = sujet;

    // Mettre à jour le titre avec le sujet
    const subjectSpan = document.getElementById('details-subject');
    if (subjectSpan) {
        subjectSpan.textContent = sujet ? `(${sujet})` : '';
    }

    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);

    // Icônes par paramètre (alignées avec les graphiques)
        // Codes de paramètre pour appliquer une couleur dédiée via CSS (pas d'emoji)
        const knownParams = new Set(['co2','pm25','tvoc','temperature','humidity']);

    // Helper pour formatter un item de détail avec style riche
    const formatIssue = (it) => {
        if (!it) return null;
        const dirTxt = it.direction === 'low' ? (t('digitalTwin.details.low') || 'trop bas')
            : (it.direction === 'high' ? (t('digitalTwin.details.high') || 'trop élevé') : (t('digitalTwin.details.out_of_range') || 'hors plage'));
        
        // Translate parameter name using i18n
        const paramCode = (it.code || '').toLowerCase();
        const paramName = t(`digitalTwin.details.parameters.${paramCode}`) || it.name || it.code || 'Paramètre';
        
        const unit = it.unit ? ` ${it.unit}` : '';
        const thresholdLabel = it.direction === 'low' 
            ? (t('digitalTwin.details.thresholdMin') || 'seuil min')
            : (t('digitalTwin.details.thresholdMax') || 'seuil max');
        const thrTxt = (typeof it.threshold === 'number')
            ? ` <span class="param-threshold">(${thresholdLabel} : ${it.threshold}${unit})</span>`
            : '';
        return {
            html: `<span class="param-value">${paramName} ${dirTxt} : ${it.value}${unit}</span>${thrTxt}`,
            severity: it.severity || 'info',
            code: paramCode
        };
    };

    const issues = (detail && Array.isArray(detail.issues)) ? detail.issues : [];
    const hasIssues = issues.length > 0;

    if (hasIssues) {
        // Afficher toutes les issues (danger, warning ET info)
        issues.forEach(it => {
            const li = document.createElement('li');
            const formatted = formatIssue(it);
            if (formatted) {
                li.innerHTML = formatted.html;
                const sevClass = formatted.severity === 'danger' ? 'issue-danger'
                    : (formatted.severity === 'warning' ? 'issue-warning' : 'issue-info');
                li.className = sevClass;
                    const pcode = formatted.code;
                    if (pcode && knownParams.has(pcode)) {
                        li.classList.add(`param-${pcode}`);
                    }
            }
            list.appendChild(li);
        });
        // Action recommandée stylisée
        const actionKey = detail && detail.actionKey;
        if (actionKey) {
            const li = document.createElement('li');
            li.className = 'issue-action';
            const actionLabel = t && t(`digitalTwin.actionVerbs.${actionKey}`);
            li.innerHTML = `<strong>${t('digitalTwin.recommendedAction') || 'Action recommandée'} :</strong> ${actionLabel || actionKey}`;
            list.appendChild(li);
        }
    } else {
        // Pas de problème détecté - tout va bien
        const li = document.createElement('li');
        li.className = 'issue-info';
        li.innerHTML = `<span class="param-value">${t('digitalTwin.allGood') || 'Tous les paramètres sont dans les normes'}</span>`;
        list.appendChild(li);
    }
}

/**
 * Gestion de la modale d'info
 */
function openModal() {
    ModalManager.open('infoModal');
}

function closeModal() {
    ModalManager.close('infoModal');
}

// Écouter les changements de pièce pour charger le modèle 3D
document.addEventListener('roomChanged', (event) => {
    const { roomId } = event.detail;
    if (typeof window.loadPieceModel === 'function') {
        window.loadPieceModel(roomId);
    }
    try { syncAlertPointsToTable(); } catch(e) {}
    
    // Fermer le panneau de détails lors du changement de pièce
    const panel = document.getElementById('details-panel');
    if (panel && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        const list = document.getElementById('details-list');
        if (list) list.innerHTML = '';
        currentDetailsSubject = null;
    }
});

document.addEventListener('enseigneChanged', () => {
    try { syncAlertPointsToTable(); } catch(e) {}
    
    // Fermer le panneau de détails lors du changement d'enseigne
    const panel = document.getElementById('details-panel');
    if (panel && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        const list = document.getElementById('details-list');
        if (list) list.innerHTML = '';
        currentDetailsSubject = null;
    }
});

// Export des fonctions
window.openModal = openModal;
window.closeModal = closeModal;
window.showDetails = showDetails;

/**
 * Met à jour le compteur d'alertes dans le label de la visualisation
 * Compte uniquement les alert-points actifs avec sévérité danger (points rouges uniquement)
 */
function updateAlertCountLabel() {
    const label = document.querySelector('.room-label');
    if (!label) return;
    
    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
    
    // Compter uniquement les alert-points actifs avec sévérité danger (points rouges)
    const activeAlerts = document.querySelectorAll('.alert-point[data-active="true"][data-severity="danger"]');
    const count = activeAlerts.length;
    
    let text;
    if (count === 0) {
        text = t('digitalTwin.alertCount.zero') || 'Aucune alerte';
    } else if (count === 1) {
        text = t('digitalTwin.alertCount.one') || '1 Alerte';
    } else {
        const template = t('digitalTwin.alertCount.multiple') || '{{count}} Alertes';
        text = template.replace('{{count}}', count);
    }
    
    label.textContent = text;
}

// Exporter la fonction pour qu'elle soit accessible depuis alerts-engine
window.updateAlertCountLabel = updateAlertCountLabel;

/**
 * Récupère et affiche le score prédit dans le panneau préventif
 */
async function fetchAndDisplayPreventiveScore(params) {
    const scoreElement = document.getElementById('preventive-score-value');
    const trendElement = document.getElementById('preventive-score-trend');
    const containerElement = document.getElementById('preventive-predicted-score');
    
    if (!scoreElement || !trendElement || !containerElement) return;
    
    try {
        // Récupérer depuis /api/iaq/actions/preventive
        const response = await fetch(`${API_ENDPOINTS.preventiveActions}?${params}`);
        const data = await response.json();
        
        // Le score prédit est inclus dans les actions préventives
        const predictedScore = data.predicted_score;
        
        if (predictedScore !== undefined) {
            const roundedScore = Math.round(predictedScore);
            scoreElement.textContent = roundedScore;
            
            // Appliquer la classe de couleur selon le score
            containerElement.classList.remove('predicted-excellent', 'predicted-warning', 'predicted-danger');
            if (roundedScore >= 70) {
                containerElement.classList.add('predicted-excellent');
            } else if (roundedScore >= 40) {
                containerElement.classList.add('predicted-warning');
            } else {
                containerElement.classList.add('predicted-danger');
            }
            
            // Calculer et afficher la tendance
            if (window.scoreHistory && window.scoreHistory.length > 0) {
                const lastScore = window.scoreHistory[window.scoreHistory.length - 1];
                const diff = roundedScore - lastScore;
                
                if (diff > 2) {
                    trendElement.textContent = '↗';
                    trendElement.className = 'predicted-trend up';
                } else if (diff < -2) {
                    trendElement.textContent = '↘';
                    trendElement.className = 'predicted-trend down';
                } else {
                    trendElement.textContent = '→';
                    trendElement.className = 'predicted-trend stable';
                }
            } else {
                trendElement.textContent = '';
                trendElement.className = 'predicted-trend';
            }
            
            // Sauvegarder dans sessionStorage
            sessionStorage.setItem('preventiveScore', JSON.stringify({ 
                predicted_score: roundedScore,
                timestamp: Date.now()
            }));
        }
    } catch (error) {
        console.error('[preventive] Error fetching score:', error);
        // Essayer de restaurer depuis le cache
        const cached = sessionStorage.getItem('preventiveScore');
        if (cached) {
            try {
                const cachedData = JSON.parse(cached);
                scoreElement.textContent = cachedData.predicted_score;
            } catch (e) {
                scoreElement.textContent = '—';
            }
        }
    }
}

/**
 * Récupère et affiche les actions préventives depuis l'API
 */
async function fetchAndDisplayPreventiveActions() {
    const container = document.getElementById('preventive-actions-container');
    if (!container) return;
    
    try {
        const cfg = (typeof window.getConfig === 'function') ? window.getConfig() : (window.config || null);
        const activeEnseigneId = (typeof window.getActiveEnseigne === 'function') 
            ? window.getActiveEnseigne() 
            : (cfg && cfg.lieux && cfg.lieux.active);
        
        const tab = document.querySelector('#room-tabs .room-tab.active');
        let activeRoomId = tab ? tab.getAttribute('data-room-id') : null;
        
        if (!activeEnseigneId || !activeRoomId) {
            // Restaurer depuis sessionStorage si disponible
            const cached = sessionStorage.getItem('preventiveActions');
            if (cached) {
                try {
                    const cachedData = JSON.parse(cached);
                    displayPreventiveActions(cachedData);
                    return;
                } catch (e) {
                    console.error('[preventive] Error parsing cached data:', e);
                }
            }
            return;
        }
        
        const ens = cfg?.lieux?.enseignes?.find(e => e.id === activeEnseigneId);
        const salle = ens?.pieces?.find(p => p.id === activeRoomId);
        
        if (!ens || !salle) {
            console.log('[preventive] Config:', { ens, salle, activeEnseigneId, activeRoomId });
            return;
        }
        
        // Les capteurs sont un array de strings dans la config
        const capteur_id = salle.capteurs?.[0] || salle.nom || 'Salon1';
        
        const params = new URLSearchParams({
            enseigne: ens.nom || 'Maison',
            salle: salle.nom || ''
        });
        
        console.log('[preventive] Fetching with params:', params.toString());
        
        const url = `${API_ENDPOINTS.preventiveActions}?${params}`;
        
        // Vérifier si apiCallWithCache existe, sinon utiliser fetch standard
        if (typeof window.apiCallWithCache === 'function') {
            await window.apiCallWithCache(
                url,
                'preventiveActions',
                (data, fromCache) => {
                    // Le score est inclus dans la réponse
                    fetchAndDisplayPreventiveScore(params).catch(e => console.warn('[preventive] Score fetch failed:', e));
                    displayPreventiveActions(data);
                    
                    // Ajouter un badge si depuis le cache
                    if (fromCache) {
                        const badge = document.createElement('div');
                        badge.className = 'cache-badge';
                        badge.textContent = '📦 Données en cache';
                        badge.style.cssText = 'font-size: 12px; color: #666; margin-top: 10px; text-align: center;';
                        container.appendChild(badge);
                    }
                },
                (error) => {
                    console.error('[preventive] All retries failed (apiCallWithCache):', error);
                    container.innerHTML = `<div class="preventive-error">
                        ⚠️ [API] Service de prédiction temporairement indisponible.<br>
                        <small>Les données seront rechargées automatiquement.</small>
                    </div>`;
                },
                { maxRetries: 2, retryDelay: 1000, useCacheOnError: true }
            );
        } else {
            // Fallback : fetch standard sans retry
            console.warn('[preventive] apiCallWithCache not available, using standard fetch');
            const response = await fetch(url);
            const data = await response.json();
            
            sessionStorage.setItem('preventiveActions', JSON.stringify(data));
            await fetchAndDisplayPreventiveScore(params).catch(e => console.warn('[preventive] Score fetch failed:', e));
            displayPreventiveActions(data);
        }
        
    } catch (error) {
        console.error('[preventive] Error fetching actions:', error);
        // Essayer de restaurer depuis le cache en cas d'erreur
        const cached = sessionStorage.getItem('preventiveActions');
        if (cached) {
            try {
                const cachedData = JSON.parse(cached);
                displayPreventiveActions(cachedData);
                // Ajouter un badge "données en cache"
                const badge = document.createElement('div');
                badge.className = 'cache-badge';
                badge.textContent = '📦 Données en cache';
                badge.style.cssText = 'font-size: 12px; color: #666; margin-top: 10px; text-align: center;';
                container.appendChild(badge);
            } catch (e) {
                console.error('[preventive] Error parsing cache:', e);
                container.innerHTML = `<div class="preventive-error">
                    ⚠️ [CACHE] Service de prédiction temporairement indisponible.<br>
                    <small>Les données seront rechargées automatiquement.</small>
                </div>`;
            }
        } else {
            console.error('[preventive] No cache available after error');
            container.innerHTML = `<div class="preventive-error">
                ⚠️ [NO CACHE] Service de prédiction temporairement indisponible.<br>
                <small>Les données seront rechargées automatiquement.</small>
            </div>`;
        }
    }
}

/**
 * Affiche les actions préventives dans le conteneur
 */
function displayPreventiveActions(data) {
    const container = document.getElementById('preventive-actions-container');
    if (!container) return;
    
    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);
    
    console.log('[displayPreventiveActions] Received data:', data);
    console.log('[displayPreventiveActions] Actions type:', typeof data.actions, 'isArray:', Array.isArray(data.actions));
    
    if (data.error || !data.actions || !Array.isArray(data.actions) || data.actions.length === 0) {
        container.innerHTML = `
            <div class="preventive-empty">
                <span class="preventive-icon"></span>
                <p>${t('digitalTwin.preventive.no_actions') || 'Aucune action préventive nécessaire. La qualité de l\'air restera bonne.'}</p>
            </div>
        `;
        return;
    }
    
    const deviceI18nMap = {
        'window': 'window',
        'ventilation': 'ventilation',
        'air_conditioning': 'air_conditioning',
        'radiator': 'radiator'
    };
    
    const actionI18nMap = {
        'open': 'open',
        'close': 'close',
        'turn_on': 'turn_on',
        'turn_off': 'turn_off',
        'increase': 'increase',
        'decrease': 'decrease'
    };
    
    let html = '';
    data.actions.forEach(action => {
        const deviceKey = deviceI18nMap[action.device] || action.device;
        const deviceName = (t && t(`digitalTwin.sample.${deviceKey}.subject`)) || action.device;
        
        const actionKey = actionI18nMap[action.action] || action.action;
        const actionVerb = (t && t(`digitalTwin.actionVerbs.${actionKey}`)) || action.action;
        
        const priorityEmoji = {
            'high': '',
            'medium': '',
            'low': ''
        }[action.priority] || '';
        
        const priorityLabel = {
            'high': 'Urgent',
            'medium': 'Recommandé',
            'low': 'Optionnel'
        }[action.priority] || action.priority;
        
        html += `
            <div class="preventive-card priority-${action.priority}">
                <div class="preventive-card-header">
                    <div class="preventive-device">
                        <strong>${deviceName}</strong>
                    </div>
                    <div class="preventive-priority">
                        ${priorityEmoji} <span>${priorityLabel}</span>
                    </div>
                </div>
                <div class="preventive-action-name">
                    <span class="action-verb">${actionVerb}</span>
                </div>
                <div class="preventive-reason">
                    ${action.reason}
                </div>
                <div class="preventive-values">
                    <div class="value-row">
                        <span class="value-label">${action.parameter}</span>
                    </div>
                    <div class="value-row">
                        <span class="value-current">${action.current_value} ${action.unit}</span>
                        <span class="value-arrow">${t('digitalTwin.preventive.arrow') || '→'}</span>
                        <span class="value-predicted">${action.predicted_value || action.current_value} ${action.unit}</span>
                        ${action.change_percent !== undefined ? 
                            `<span class="value-percent ${action.change_percent > 0 ? 'increasing' : 'decreasing'}">
                                (${action.change_percent > 0 ? '+' : ''}${action.change_percent.toFixed(1)}%)
                            </span>` : ''}
                    </div>
                    ${action.trend ? `<div class="value-row trend-row">
                        <span class="trend-indicator trend-${action.trend}">
                            ${action.trend === 'increasing' ? '📈 En augmentation' : action.trend === 'decreasing' ? '📉 En diminution' : '➡️ Stable'}
                        </span>
                    </div>` : ''}
                    ${action.forecast_minutes ? `<div class="value-row forecast-row">
                        <span class="forecast-time">⏱️ Prévision à ${action.forecast_minutes} min</span>
                    </div>` : ''}
                    ${action.is_ml_action ? `<div class="value-row ml-row">
                        <span class="ml-badge">🤖 Prédiction ML</span>
                    </div>` : ''}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Sync alert-point elements into the actions table as rows
function syncAlertPointsToTable() {
    const tbody = document.querySelector('.actions-table tbody');
    if (!tbody) {
        console.warn('[digital-twin] Actions table tbody not found');
        return;
    }

    // Vérifier si le panneau de détails est ouvert et stocker le sujet actuel
    const panel = document.getElementById("details-panel");
    const isPanelOpen = panel && !panel.classList.contains('hidden');
    const previousSubject = currentDetailsSubject;

    // remove previously injected rows
    Array.from(tbody.querySelectorAll('tr.dynamic-alert')).forEach(r => r.remove());

    // Get active context (enseigne + salle)
    const getActiveContext = () => {
        try {
            const cfg = (typeof window.getConfig === 'function') ? window.getConfig() : (window.config || null);
            const activeEnseigneId = (typeof window.getActiveEnseigne === 'function') 
                ? window.getActiveEnseigne() 
                : (cfg && cfg.lieux && cfg.lieux.active);
            
            // Essayer de récupérer activeRoomId depuis le tab actif
            const tab = document.querySelector('#room-tabs .room-tab.active');
            let activeRoomId = tab ? tab.getAttribute('data-room-id') : null;
            
            // Si pas de tab actif, prendre la première pièce de l'enseigne active
            if (!activeRoomId && cfg && cfg.lieux && cfg.lieux.enseignes) {
                const ens = cfg.lieux.enseignes.find(e => e.id === activeEnseigneId);
                if (ens && ens.pieces && ens.pieces.length > 0) {
                    activeRoomId = ens.pieces[0].id;
                }
            }
            
            return { activeEnseigneId, activeRoomId };
        } catch(e) {
            console.error('[digital-twin] Error getting active context:', e);
            return { activeEnseigneId: null, activeRoomId: null };
        }
    };
    
    const { activeEnseigneId, activeRoomId } = getActiveContext();

    // Only include active alert points that belong to the current enseigne/salle
    const allActivePoints = Array.from(document.querySelectorAll('.alert-point[data-active="true"]'));
    
    const points = allActivePoints.filter(pt => {
        const ptEnseigne = pt.getAttribute('data-enseigne');
        const ptPiece = pt.getAttribute('data-piece');
        const matches = (ptEnseigne === activeEnseigneId && ptPiece === activeRoomId);
        return matches;
    });
    
    if (!points || points.length === 0) {
        return;
    }

    const t = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : (()=>undefined);

    // Grouper les points par type (data-i18n-key) pour éviter les doublons dans le tableau
    const pointsByType = {};
    
    points.forEach(pt => { 
        const explicitKey = pt.getAttribute('data-i18n-key');
        if (!explicitKey) return;
        
        if (!pointsByType[explicitKey]) {
            pointsByType[explicitKey] = [];
        }
        pointsByType[explicitKey].push(pt);
    });

    const builtRows = [];

    // Traiter chaque type unique
    Object.entries(pointsByType).forEach(([typeKey, typePoints]) => {
        // Prendre la sévérité la plus grave pour ce type
        const severities = typePoints.map(pt => pt.getAttribute('data-severity') || 'info');
        const severityWeights = { 'danger': 0, 'warning': 1, 'info': 2 };
        const maxSeverity = severities.reduce((max, sev) => 
            severityWeights[sev] < severityWeights[max] ? sev : max, 'info');
        
        console.log(`[digital-twin] Processing type ${typeKey} with ${typePoints.length} points, max severity: ${maxSeverity}`);
        
        const severityLower = maxSeverity.toLowerCase();
        const severityMap = {
            'danger': { emoji: '🔴', cls: 'alert-red' },
            'warning': { emoji: '🟠', cls: 'alert-yellow' },
            'info': { emoji: '🟢', cls: 'alert-green' }
        };
        const sev = severityMap[severityLower] || severityMap['danger'];
        
        const tr = document.createElement('tr');
        tr.className = `dynamic-alert ${sev.cls}`;

        const tdState = document.createElement('td'); tdState.textContent = sev.emoji;
        const tdSubj = document.createElement('td');
        const tdAct = document.createElement('td');

        // Utiliser le premier point pour les clés i18n et actions
        const firstPoint = typePoints[0];
        const actionKeyDyn = firstPoint.getAttribute('data-action-key');
        
        const subjectKey = `digitalTwin.sample.${typeKey}.subject`;
        const actionKey = `digitalTwin.sample.${typeKey}.action`;

        // If i18n keys exist, attach data-i18n so translations update automatically
        const subjTxt = (t && t(subjectKey)) || null;
        const dynI18nKey = actionKeyDyn ? `digitalTwin.actionVerbs.${actionKeyDyn}` : null;
        const dynActTxt = dynI18nKey && t ? t(dynI18nKey) : null;
        const actTxtFallback = (t && t(actionKey)) || null;

        // Always attach data-i18n so later translation passes can update these cells
        tdSubj.setAttribute('data-i18n', subjectKey);
        tdSubj.textContent = (subjTxt) ? subjTxt : typeKey;

        // Action column shows dynamic recommendation when available, else subject default
        if (actionKeyDyn) tdAct.setAttribute('data-i18n', dynI18nKey);
        else tdAct.setAttribute('data-i18n', actionKey);
        tdAct.textContent = (dynActTxt) ? dynActTxt : (actTxtFallback ? actTxtFallback : ((t && t('digitalTwin.details')) || 'Détails'));

        // Préparer les détails combinés de tous les points de ce type
        let combinedDetails = null;
        try {
            // Prendre les détails du premier point pour l'instant
            const raw = firstPoint.getAttribute('data-details');
            combinedDetails = raw ? JSON.parse(raw) : null;
        } catch(e) { combinedDetails = null; }
        
        // Stocker les détails dans la ligne
        tr._detailsData = combinedDetails;
        
        // Clicking the row should open details using the visible subject text and detail object
        tr.addEventListener('click', () => {
            const subj = tdSubj.textContent.trim();
            showDetails(subj, combinedDetails);
        });

        tr.appendChild(tdState);
        tr.appendChild(tdSubj);
        tr.appendChild(tdAct);

        // Queue row with severity weight for sorting
        const weight = severityWeights[severityLower];
        console.log(`[digital-twin] Adding grouped row for ${typeKey} with weight ${weight}`);
        builtRows.push({ tr, weight });
    });

    // apply translations for newly inserted nodes
    // sort rows: danger first, then warning, then info
    builtRows.sort((a,b) => a.weight - b.weight);
    
    // Vérifier si le sujet du panneau ouvert existe encore dans les nouvelles lignes
    let newDetailsForSubject = null;
    let subjectStillExists = false;
    if (isPanelOpen && previousSubject) {
        for (const { tr } of builtRows) {
            const subjCell = tr.querySelector('td:nth-child(2)');
            if (subjCell && subjCell.textContent.trim() === previousSubject) {
                subjectStillExists = true;
                // Récupérer les nouveaux détails de cette ligne
                const clickHandler = tr._detailsData;
                if (clickHandler) {
                    newDetailsForSubject = clickHandler;
                }
                break;
            }
        }
    }
    
    builtRows.forEach(({ tr }) => tbody.appendChild(tr));
    try { if (window.i18n && typeof window.i18n._applyTranslations === 'function') window.i18n._applyTranslations(tbody); } catch(e){}
    
    // Toujours mettre à jour le panneau s'il est ouvert et que le sujet existe encore
    if (isPanelOpen && previousSubject) {
        if (subjectStillExists && newDetailsForSubject !== null) {
            showDetails(previousSubject, newDetailsForSubject, true); // forceRefresh = true
        } else if (!subjectStillExists) {
            // Si le sujet n'existe plus, fermer le panneau
            const panel = document.getElementById('details-panel');
            if (panel) {
                panel.classList.add('hidden');
                const list = document.getElementById('details-list');
                if (list) list.innerHTML = '';
                currentDetailsSubject = null;
            }
        }
    }
    
    // Mettre à jour le compteur d'alertes
    if (typeof window.updateAlertCountLabel === 'function') {
        window.updateAlertCountLabel();
    }
}

// run once on DOMContentLoaded and whenever language changes
document.addEventListener('DOMContentLoaded', () => { 
    try { 
        syncAlertPointsToTable(); 
        fetchAndDisplayPreventiveActions();
        // Rafraîchir les actions préventives toutes les 30 secondes
        setInterval(fetchAndDisplayPreventiveActions, 30000);
    } catch(e){
        console.error('[digital-twin] Error in DOMContentLoaded:', e);
    } 
});
window.addEventListener('language-changed', () => { 
    try { 
        syncAlertPointsToTable();
        // Rafraîchir l'affichage des actions préventives avec les nouvelles traductions
        const cached = sessionStorage.getItem('preventiveActions');
        if (cached) {
            const cachedData = JSON.parse(cached);
            displayPreventiveActions(cachedData);
        }
        // Rafraîchir aussi le score prédit
        const cachedScore = sessionStorage.getItem('preventiveScore');
        if (cachedScore) {
            const scoreData = JSON.parse(cachedScore);
            const scoreElement = document.getElementById('preventive-score-value');
            if (scoreElement) {
                scoreElement.textContent = scoreData.predicted_score;
            }
        }
    } catch(e){} 
});

// Rafraîchir les actions préventives lors du changement de pièce ou d'enseigne
document.addEventListener('roomChanged', () => { 
    try { fetchAndDisplayPreventiveActions(); } catch(e){} 
});
document.addEventListener('enseigneChanged', () => { 
    try { fetchAndDisplayPreventiveActions(); } catch(e){} 
});
