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
        
        // Forcer le resize du canvas 3D et du container après fermeture du panel
        setTimeout(() => {
            const twinLayout = document.querySelector('.twin-layout');
            if (twinLayout) {
                twinLayout.style.gridTemplateRows = 'auto'; // Réinitialiser les lignes
            }
            window.dispatchEvent(new Event('resize'));
        }, 50);
        return;
    }

    panel.classList.remove("hidden");
    list.innerHTML = "";
    currentDetailsSubject = sujet;
    
    // Forcer le resize du canvas 3D et du container après ouverture du panel
    setTimeout(() => {
        const twinLayout = document.querySelector('.twin-layout');
        if (twinLayout) {
            twinLayout.style.gridTemplateRows = 'auto auto'; // Deux lignes actives
        }
        window.dispatchEvent(new Event('resize'));
    }, 50);

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
    const formatNumber = (num, decimals = 2) => {
        // Accept number or numeric string
        const n = (typeof num === 'number') ? num : (typeof num === 'string' ? Number(num) : NaN);
        if (Number.isNaN(n)) return num; // return original if not numeric
        // To avoid unnecessary trailing zeros, use Number to normalize
        return Number(n.toFixed(decimals));
    };

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
            ? ` <span class="param-threshold">(${thresholdLabel} : ${formatNumber(it.threshold)}${unit})</span>`
            : '';
        const displayedValue = (typeof it.value === 'number') ? formatNumber(it.value) : it.value;
        return {
            html: `<span class="param-value">${paramName} ${dirTxt} : ${displayedValue}${unit}</span>${thrTxt}`,
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
            li.innerHTML = `<strong>${(t && t('digitalTwin.tip.recommendedAction')) || 'Action recommandée'} :</strong> ${actionLabel || actionKey}`;
            list.appendChild(li);
        }
    } else {
        // Pas de problème détecté - tout va bien
        const li = document.createElement('li');
        li.className = 'issue-info';
        li.innerHTML = `<span class="param-value">${t('digitalTwin.tip.allGood') || 'Tous les paramètres sont dans les normes'}</span>`;
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

function closeDetailsPanel() {
    const panel = document.getElementById("details-panel");
    if (panel && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        const list = document.getElementById('details-list');
        if (list) list.innerHTML = '';
        currentDetailsSubject = null;
    }
}
window.closeDetailsPanel = closeDetailsPanel;

// Écouter les changements de pièce pour charger le modèle 3D
document.addEventListener('roomChanged', (event) => {
    const { roomId } = event.detail;
    if (typeof window.loadPieceModel === 'function') {
        window.loadPieceModel(roomId);
    }
    try { syncAlertPointsToTable(); } catch(e) {}
    
    // Fermer le panneau de détails lors du changement de pièce
    closeDetailsPanel();
});

document.addEventListener('enseigneChanged', () => {
    try { syncAlertPointsToTable(); } catch(e) {}
    
    // Fermer le panneau de détails lors du changement d'enseigne
    closeDetailsPanel();
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
        const response = await fetch(`${API_ENDPOINTS.preventiveActions}?${params}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
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
window.syncAlertPointsToTable = function syncAlertPointsToTable() {
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

    // Grouper les points par target-names (nom d'objet 3D unique) pour créer une ligne par objet
    const pointsByTarget = {};
    
    points.forEach(pt => { 
        const explicitKey = pt.getAttribute('data-i18n-key');
        const targetName = pt.getAttribute('data-target-names');
        if (!explicitKey || !targetName) return;
        
        // Clé unique basée sur le nom de l'objet 3D
        if (!pointsByTarget[targetName]) {
            pointsByTarget[targetName] = {
                type: explicitKey,
                targetName: targetName,
                points: []
            };
        }
        pointsByTarget[targetName].points.push(pt);
    });

    // Compter combien d'objets de chaque type pour numérotation
    const typeCount = {};
    const typeObjects = {};
    Object.entries(pointsByTarget).forEach(([targetName, group]) => {
        const type = group.type;
        if (!typeCount[type]) {
            typeCount[type] = 0;
            typeObjects[type] = [];
        }
        typeCount[type]++;
        typeObjects[type].push(targetName);
    });

    const builtRows = [];

    // Traiter chaque objet distinct (par targetName)
    Object.entries(pointsByTarget).forEach(([targetName, group]) => {
        const typeKey = group.type;
        const typePoints = group.points;
        
        // Déterminer l'emoji basé sur l'état (rouge si fermé/éteint, vert si ouvert/allumé)
        const states = typePoints.map(pt => {
            const state = pt.getAttribute('data-state');
            if (state) return state;
            // Fallback : si pas de data-state, utiliser severity pour déduire l'état
            const severity = pt.getAttribute('data-severity');
            if (severity === 'info') {
                // info = pas de problème = ouvert/allumé
                const key = pt.getAttribute('data-i18n-key');
                return (key === 'door' || key === 'window') ? 'open' : 'on';
            } else {
                // warning/danger = problème = fermé/éteint
                const key = pt.getAttribute('data-i18n-key');
                return (key === 'door' || key === 'window') ? 'closed' : 'off';
            }
        });
        const hasClosedOrOff = states.some(s => s === 'closed' || s === 'off');
        // REMPLACÉ: Utilisation d'indicateurs CSS au lieu d'emojis
        
        // Déterminer la classe CSS basée sur la gravité (pour les couleurs)
        const severities = typePoints.map(pt => pt.getAttribute('data-severity') || 'info');
        const severityWeights = { 'danger': 0, 'warning': 1, 'info': 2 };
        const maxSeverity = severities.reduce((max, sev) => 
            severityWeights[sev] < severityWeights[max] ? sev : max, 'info');
        const severityLower = maxSeverity.toLowerCase();
        const severityMap = {
            'danger': { cls: 'alert-red' },
            'warning': { cls: 'alert-yellow' },
            'info': { cls: 'alert-green' }
        };
        const sev = severityMap[severityLower] || severityMap['danger'];
        
        const tr = document.createElement('tr');
        tr.className = `dynamic-alert ${sev.cls}`;

        const tdState = document.createElement('td'); 
        // NOUVEAU STYLE : Indicateur visuel
        const indicator = document.createElement('div');
        indicator.className = hasClosedOrOff ? 'status-indicator status-red' : 'status-indicator status-green';
        tdState.appendChild(indicator);
        const tdSubj = document.createElement('td');
        const tdAct = document.createElement('td');

        // Utiliser le premier point pour les clés i18n et actions
        const firstPoint = typePoints[0];
        let actionKeyToCompare = firstPoint.getAttribute('data-action-key');
        
        // Fallback aux actions par défaut si pas d'action dynamique (pour les lignes grises)
        if (!actionKeyToCompare) {
            const defaultActions = {
                'window': 'close',
                'door': 'close',
                'ventilation': 'turn_on',
                'radiator': 'decrease',
                'air_conditioning': 'turn_on',
                'air_purifier': 'turn_on'
            };
            actionKeyToCompare = defaultActions[typeKey];
        }
        
        // Vérifier si l'état actuel correspond à l'action demandée (Action satisfaite)
        // Si oui, on passe la ligne en vert (alert-success)
        if (actionKeyToCompare) {
            // Déterminer l'état sémantique actuel
            const currentState = hasClosedOrOff ? (typeKey === 'door' || typeKey === 'window' ? 'closed' : 'off') 
                                                : (typeKey === 'door' || typeKey === 'window' ? 'open' : 'on');
            
            let isSatisfied = false;
            // Mapping des actions aux états satisfaisants
            if (currentState === 'open' && actionKeyToCompare === 'open') isSatisfied = true;
            else if (currentState === 'closed' && actionKeyToCompare === 'close') isSatisfied = true;
            else if (currentState === 'on' && (actionKeyToCompare === 'turn_on' || actionKeyToCompare === 'activate' || actionKeyToCompare === 'increase')) isSatisfied = true;
            else if (currentState === 'off' && (actionKeyToCompare === 'turn_off' || actionKeyToCompare === 'deactivate' || actionKeyToCompare === 'decrease')) isSatisfied = true;
            
            if (isSatisfied) {
                tr.className = `dynamic-alert alert-success`;
            }
        }
        
        // Pour l'affichage, on garde la logique originale pour actionKeyDyn
        const actionKeyDyn = firstPoint.getAttribute('data-action-key');
        
        const subjectKey = `digitalTwin.sample.${typeKey}.subject`;
        const actionKey = `digitalTwin.sample.${typeKey}.action`;

        // If i18n keys exist, attach data-i18n so translations update automatically
        let subjTxt = (t && t(subjectKey)) || typeKey;
        
        // Si plusieurs objets du même type, ajouter un numéro (Fenêtre 1, Fenêtre 2, etc.)
        if (typeCount[typeKey] > 1) {
            const objectIndex = typeObjects[typeKey].indexOf(targetName) + 1;
            subjTxt = `${subjTxt} ${objectIndex}`;
        }
        
        const dynI18nKey = actionKeyDyn ? `digitalTwin.actionVerbs.${actionKeyDyn}` : null;
        const dynActTxt = dynI18nKey && t ? t(dynI18nKey) : null;
        const actTxtFallback = (t && t(actionKey)) || null;

        // Attacher data-i18n pour les traductions
        tdSubj.setAttribute('data-i18n', subjectKey);
        tdSubj.textContent = subjTxt; // Texte avec numéro si plusieurs objets du même type

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
        let weight = severityWeights[severityLower];
        
        // Si la ligne est verte (succès), on la met tout en bas (poids plus élevé)
        if (tr.classList.contains('alert-success')) {
            weight = 10; // Poids élevé pour être à la fin
        }

        console.log(`[digital-twin] Adding grouped row for ${typeKey} with severity weight ${weight}`);
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

// Listen for IAQ data updates to update the overlay
document.addEventListener('iaqDataUpdated', (event) => {
    const data = event.detail;
    if (!data) return;

    const updateElement = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            // Format numbers: 0 decimals for CO2, 1 for others
            let formatted = '--';
            if (value !== undefined && value !== null && !isNaN(value)) {
                const num = Number(value);
                if (id === 'overlay-co2') {
                    formatted = num.toFixed(0);
                } else {
                    formatted = num.toFixed(1);
                }
            }
            el.textContent = formatted;
        }
    };

    updateElement('overlay-co2', data.co2);
    updateElement('overlay-pm25', data.pm25);
    updateElement('overlay-tvoc', data.tvoc);
    updateElement('overlay-temp', data.temperature);
    updateElement('overlay-hum', data.humidity);
});

// Legend Modal Functions
function openLegendModal() {
    const modal = document.getElementById('legendModal');
    if (modal) {
        modal.style.display = 'flex'; // Use flex to center
        // Close when clicking outside
        window.onclick = function(event) {
            if (event.target == modal) {
                closeLegendModal();
            }
        }
    }
}

function closeLegendModal() {
    const modal = document.getElementById('legendModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Listener pour les mises à jour de configuration (ex: changement de paysage)
document.addEventListener('DOMContentLoaded', () => {
    if (typeof WebSocketManager !== 'undefined') {
        const ws = new WebSocketManager();
        ws.connect();
        
        const handleConfigUpdate = (data) => {
            if (data && data.config) {
                console.log('🔄 Config updated via WS', data.config);
                // Mettre à jour le cache global
                if (window.setConfig) window.setConfig(data.config);
                
                // Mettre à jour l'environnement 3D si la fonction est disponible
                if (window.updateThreeEnvironment) {
                    window.updateThreeEnvironment(data.config);
                }
            }
        };

        ws.listeners.set('config_updated', handleConfigUpdate);
        
        // Ecouter aussi sur le topic 'all' si nécessaire
        ws.listeners.set('all', (data) => {
             if (data.type === 'config_updated') {
                 handleConfigUpdate(data);
             }
        });
    }
});

