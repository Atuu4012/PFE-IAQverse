/* Alerts Engine: evaluates IAQ data against thresholds and toggles alert-points visibility/severity */
(function (window) {
    const REFRESH_MS = 5000; // polling frequency
    const API_URL_DATA = "http://localhost:8000/api/iaq/data";
    // Centralise all thresholds here to avoid magic numbers
    const THRESHOLDS = {
        CO2: { WARNING: 800, DANGER: 1200 },
        PM25: { WARNING: 5, WARNING_MED: 15, DANGER: 35 }, // keep 5 for conservative warn, 15 used in actions, 35 danger
        TVOC: { WARNING: 300, DANGER: 1000 },
        TEMP: {
            INFO_MIN: 18, INFO_MAX: 22,
            WARN_LOW_START: 16, WARN_LOW_END: 18,
            WARN_MID_START: 22, WARN_MID_END: 24,
            WARN_HIGH_START: 24, WARN_HIGH_END: 28,
            DANGER_LOW: 16, DANGER_HIGH: 28,
            ACTION_COLD: 18, ACTION_HOT: 24
        },
        HUM: {
            INFO_MIN: 40, INFO_MAX: 60,
            WARN_LOW_MIN: 20, WARN_LOW_MAX: 30,
            WARN_HIGH_MIN: 70, WARN_HIGH_MAX: 80,
            DANGER_LOW: 20, DANGER_HIGH: 80,
            ACTION_TOO_DRY: 30, ACTION_TOO_HUMID: 60, ACTION_OPEN_THRESHOLD: 70
        }
    };
    // mémorise la dernière sévérité notifiée pour éviter le spam
    let lastNotified = { temp: null, hum: null };

    // Severity helpers
    const weights = { info: 0, warning: 1, danger: 2 };
    const maxSeverity = (a, b) => (weights[a] >= weights[b] ? a : b);

    // Threshold evaluators
    function evalCO2(co2) {
        if (co2 == null || isNaN(co2)) return null;
        if (co2 >= THRESHOLDS.CO2.DANGER) return "danger";
        if (co2 >= THRESHOLDS.CO2.WARNING) return "warning";
        return "info";
    }
    function evalPM25(pm) {
        if (pm == null || isNaN(pm)) return null;
        if (pm >= THRESHOLDS.PM25.DANGER) return "danger"; // OMS 2021 jour
        if (pm >= THRESHOLDS.PM25.WARNING) return "warning"; // conservative warn
        return "info";
    }
    function evalTVOC(tvoc) {
        if (tvoc == null || isNaN(tvoc)) return null;
        if (tvoc > THRESHOLDS.TVOC.DANGER) return "danger";
        if (tvoc >= THRESHOLDS.TVOC.WARNING) return "warning"; // <200 très bon
        return "info";
    }
    function evalTemp(t) {
        if (t == null || isNaN(t)) return null;
        if (t < THRESHOLDS.TEMP.DANGER_LOW || t > THRESHOLDS.TEMP.DANGER_HIGH) return "danger"; // zones OMS extrêmes
        if ((t >= THRESHOLDS.TEMP.WARN_LOW_START && t < THRESHOLDS.TEMP.WARN_LOW_END)
            || (t > THRESHOLDS.TEMP.WARN_MID_START && t <= THRESHOLDS.TEMP.WARN_MID_END)
            || (t > THRESHOLDS.TEMP.WARN_HIGH_START && t <= THRESHOLDS.TEMP.WARN_HIGH_END)) return "warning"; // bandes intermédiaires / inconfort léger
        if (t >= THRESHOLDS.TEMP.INFO_MIN && t <= THRESHOLDS.TEMP.INFO_MAX) return "info";
        return null;
    }
    function evalHum(h) {
        if (h == null || isNaN(h)) return null;
        if (h < THRESHOLDS.HUM.DANGER_LOW || h > THRESHOLDS.HUM.DANGER_HIGH) return "danger";
        if ((h >= THRESHOLDS.HUM.WARN_LOW_MIN && h < THRESHOLDS.HUM.WARN_LOW_MAX)
            || (h > THRESHOLDS.HUM.INFO_MAX && h <= THRESHOLDS.HUM.WARN_HIGH_MIN)
            || (h > THRESHOLDS.HUM.WARN_HIGH_MIN && h <= THRESHOLDS.HUM.WARN_HIGH_MAX)) return "warning";
        if (h >= THRESHOLDS.HUM.INFO_MIN && h <= THRESHOLDS.HUM.INFO_MAX) return "info";
        return null;
    }

    // Map pollutant severities to alert-point keys
    function deriveAlertPointSeverities(last) {
        const out = {}; // key -> severity
        const push = (key, sev) => {
            if (!sev) return;
            if (!out[key]) out[key] = sev;
            else out[key] = maxSeverity(out[key], sev);
        };
    const sCO2 = evalCO2(Number(last.co2));
    const sPM = evalPM25(Number(last.pm25));
    const sTVOC = evalTVOC(Number(last.tvoc));
    const sTemp = evalTemp(Number(last.temperature));
    const sHum = evalHum(Number(last.humidity));
        // CO2: ventil + window (and door as secondary) when warning/danger
        if (sCO2 && sCO2 !== "info") {
            push("ventilation", sCO2);
            push("window", sCO2);
            push("door", sCO2);
        }
        // PM2.5: ventil
        if (sPM && sPM !== "info") {
            push("window", sPM);
            push("ventilation", sPM);
        }
        // TVOC: ventil
        if (sTVOC && sTVOC !== "info") {
            push("ventilation", sTVOC);
        }
        // Température: radiator (chauffage) & window (aération) selon extrêmes
        if (sTemp && sTemp !== 'info') {
            push('radiator', sTemp);
            push('window', sTemp);
        }
        // Humidité: ventilation & window (aérer ou déshumidifier) hors plage de confort
        if (sHum && sHum !== 'info') {
            push('ventilation', sHum);
            push('radiator', sHum);
            push('window', sHum);
        }
        return out;
    }

    function applyAlertPointsActivation(map, actionsMap) {
        // Récupérer tous les alert-points
        const allAlertPoints = document.querySelectorAll(".alert-point");
        
        // Si aucun point n'existe, attendre un peu et réessayer
        if (allAlertPoints.length === 0) {
            console.log('[alerts-engine] No alert-points found, waiting and retrying...');
            setTimeout(() => applyAlertPointsActivation(map, actionsMap), 1000);
            return;
        }
        
        if (!activeEnseigneId || !activeRoomId) {
            console.warn('[alerts-engine] No active context, deactivating all');
            // Pas de contexte actif, désactiver tous les alert-points
            allAlertPoints.forEach((el) => {
                el.setAttribute("data-active", "false");
                el.removeAttribute("data-severity");
                el.removeAttribute("data-action-key");
            });
            try {
                if (typeof window.syncAlertPointsToTable === "function")
                    window.syncAlertPointsToTable();
            } catch (e) { }
            return;
        }
        
        let activatedCount = 0;
        // Helper: build details for a given device key based on latestSample
        function buildDetailsForKey(deviceKey) {
            const issues = [];
            if (!latestSample) return { issues, actionKey: actionsMap && actionsMap[deviceKey] };
            const last = latestSample;
            // Exclure les infos des détails (uniquement warning et danger)
            const pushIssue = (code, name, unit, sev, value, dir, threshold) => {
                if (!sev || sev === 'info') return;
                issues.push({ code, name, unit, severity: sev, value, direction: dir, threshold });
            };
            // Compute severities
            const sCO2 = evalCO2(Number(last.co2));
            const sPM = evalPM25(Number(last.pm25));
            const sTVOC = evalTVOC(Number(last.tvoc));
            const sTemp = evalTemp(Number(last.temperature));
            const sHum = evalHum(Number(last.humidity));

            const addCO2 = () => {
                if (!sCO2 || sCO2 === 'info') return; const thr = (sCO2 === 'danger') ? THRESHOLDS.CO2.DANGER : THRESHOLDS.CO2.WARNING; pushIssue('co2', 'CO₂', 'ppm', sCO2, Number(last.co2), 'high', thr);
            };
            const addPM = () => {
                if (!sPM || sPM === 'info') return; const thr = (sPM === 'danger') ? THRESHOLDS.PM25.DANGER : THRESHOLDS.PM25.WARNING; pushIssue('pm25', 'PM2.5', 'µg/m³', sPM, Number(last.pm25), 'high', thr);
            };
            const addTVOC = () => {
                if (!sTVOC || sTVOC === 'info') return; const thr = (sTVOC === 'danger') ? THRESHOLDS.TVOC.DANGER : THRESHOLDS.TVOC.WARNING; pushIssue('tvoc', 'TVOC', 'mg/m³', sTVOC, Number(last.tvoc), 'high', thr);
            };
            const addTemp = () => {
                if (!sTemp || sTemp === 'info') return; const t = Number(last.temperature);
                let dir = null, thr = null;
                if (t < THRESHOLDS.TEMP.WARN_LOW_END) { dir = 'low'; thr = THRESHOLDS.TEMP.WARN_LOW_END; }
                else if (t > THRESHOLDS.TEMP.WARN_HIGH_START) { dir = 'high'; thr = THRESHOLDS.TEMP.WARN_HIGH_START; }
                pushIssue('temperature', 'Température', '°C', sTemp, t, dir, thr);
            };
            const addHum = () => {
                if (!sHum || sHum === 'info') return; const h = Number(last.humidity);
                let dir = null, thr = null;
                if (h < THRESHOLDS.HUM.WARN_LOW_MAX) { dir = 'low'; thr = THRESHOLDS.HUM.WARN_LOW_MAX; }
                else if (h > THRESHOLDS.HUM.WARN_HIGH_MIN) { dir = 'high'; thr = THRESHOLDS.HUM.WARN_HIGH_MIN; }
                pushIssue('humidity', 'Humidité', '%', sHum, h, dir, thr);
            };

            switch (deviceKey) {
                case 'window':
                    addCO2(); addPM(); addTemp(); addHum(); break;
                case 'ventilation':
                    addCO2(); addPM(); addTVOC(); addHum(); break;
                case 'radiator':
                    addTemp(); addHum(); break;
                case 'door':
                    addCO2(); break;
                default:
                    addCO2(); addPM(); addTVOC(); addTemp(); addHum(); break;
            }
            return { issues, actionKey: actionsMap && actionsMap[deviceKey] };
        }

        // Filtrer et activer uniquement les alert-points de la pièce active
        allAlertPoints.forEach((el) => {
            const pointEnseigne = el.getAttribute('data-enseigne');
            const pointPiece = el.getAttribute('data-piece');
            const key = el.getAttribute('data-i18n-key');
            
            // Vérifier que l'alert-point appartient à la pièce active
            if (pointEnseigne !== activeEnseigneId || pointPiece !== activeRoomId) {
                el.setAttribute("data-active", "false");
                el.removeAttribute("data-severity");
                el.removeAttribute("data-action-key");
                return;
            }
            
            // Activer ou désactiver selon la map
            // Tous les alert-points de la pièce active sont activés avec "info" par défaut
            const severity = (map && map[key]) ? map[key] : 'info';
            console.log(`[alerts-engine] Activating alert-point ${key} with severity: ${severity} (was in map: ${!!(map && map[key])})`);
            el.setAttribute("data-active", "true");
            el.setAttribute("data-severity", severity);
            
            if (actionsMap && actionsMap[key]) {
                el.setAttribute("data-action-key", actionsMap[key]);
            }
            
            try {
                const det = buildDetailsForKey(key);
                el.setAttribute('data-details', JSON.stringify(det));
            } catch (e) { /* ignore JSON issues */ }
            
            // Masquer les alert-points de type "info" dans la 3D (mais garder data-active pour le tableau)
            if (severity === 'info') {
                el.style.display = 'none';
            } else {
                el.style.display = ''; // Afficher les autres sévérités
                activatedCount++;
            }
        });
        
        // Sync actions table
        try {
            if (typeof window.syncAlertPointsToTable === "function")
                window.syncAlertPointsToTable();
        } catch (e) { }
        
        // Update alert count label
        try {
            if (typeof window.updateAlertCountLabel === "function")
                window.updateAlertCountLabel();
        } catch (e) { }
    }

    /**
     * Met à jour le label du compteur d'alertes visibles
     */
    function updateAlertCountLabel() {
        const label = document.querySelector('.room-label');
        if (!label) {
            return;
        }

        // Compter seulement les points d'alerte visibles avec des positions distinctes
        const allPoints = document.querySelectorAll('.alert-point');
        const visiblePoints = Array.from(allPoints).filter(point => {
            const style = window.getComputedStyle(point);
            return style.display !== 'none' && point.offsetWidth > 0 && point.offsetHeight > 0;
        });
        
        // Grouper par position pour éviter de compter les points superposés
        const positionGroups = {};
        visiblePoints.forEach(point => {
            const left = point.style.left;
            const top = point.style.top;
            const key = `${left}-${top}`;
            if (!positionGroups[key]) {
                positionGroups[key] = [];
            }
            positionGroups[key].push(point);
        });
        
        // Compter un point par position unique
        const count = Object.keys(positionGroups).length;

        const singularText = window.i18n && window.i18n.t ? window.i18n.t('digitalTwin.alertCount.singular', { count }) : null;
        const pluralText = window.i18n && window.i18n.t ? window.i18n.t('digitalTwin.alertCount.plural', { count }) : null;
        
        const text = count === 1 ? 
            (singularText || `${count} Alerte`) :
            (pluralText || `${count} Alertes`);
        
        label.textContent = text;
        
        // Forcer un reflow pour s'assurer que le texte est rendu
        label.style.display = 'none';
        label.offsetHeight; // Trigger reflow
        label.style.display = '';
    }

    // Exposer la fonction globalement
    window.updateAlertCountLabel = updateAlertCountLabel;

    // Définition des alert-points par défaut (positions et cibles)
    const DEFAULT_ALERT_POINTS = [
        {
            key: 'window',
            targetNames: 'Window|Fenetre|Fenêtre|window|fenetre',
            style: 'top: 20%; left: 30%; transform: translate(-50%, -50%);'
        },
        {
            key: 'door',
            targetNames: 'Door|Porte|porte|door',
            style: 'top: 50%; left: 10%; transform: translate(-50%, -50%);'
        },
        {
            key: 'ventilation',
            targetNames: 'Ventilation|VMC|ventilation|vmc|extracteur|Clim|clim',
            style: 'top: 10%; left: 50%; transform: translate(-50%, -50%);'
        },
        {
            key: 'radiator',
            targetNames: 'Radiator|Chauffage|radiateur|chauffage|heater',
            style: 'top: 80%; left: 20%; transform: translate(-50%, -50%);'
        }
    ];

    /**
     * Génère les alert-points pour une pièce spécifique
     * Met à jour les attributs des alert-points existants au lieu de les recréer
     */
    function renderAlertPoints(enseigneId, pieceId) {
        console.log(`[alerts-engine] renderAlertPoints called for ${enseigneId}/${pieceId}`);

        const container = document.getElementById('alert-points-container');
        if (!container) {
            console.error('[alerts-engine] alert-points-container not found in DOM!');
            return;
        }

        // Au lieu de vider complètement, mettre à jour les attributs des alert-points existants
        const existingPoints = container.querySelectorAll('.alert-point');
        console.log(`[alerts-engine] Found ${existingPoints.length} existing alert-points to update`);

        existingPoints.forEach(point => {
            // Mettre à jour les attributs sans changer les noms d'objets 3D
            point.setAttribute('data-enseigne', enseigneId);
            point.setAttribute('data-piece', pieceId);
            point.setAttribute('data-active', 'false'); // Par défaut inactif
            console.log(`[alerts-engine] Updated alert-point: ${point.getAttribute('data-i18n-key')}`);
        });

        // Si aucun point n'existe, ne rien faire (les points seront créés par autoGenerateAlertPoints)
        if (existingPoints.length === 0) {
            console.log('[alerts-engine] No existing points found - they will be created by autoGenerateAlertPoints');
            return;
        }
    }

    // Track active enseigne/salle
    let activeEnseigneName = null;
    let activeRoomName = null;
    let activeEnseigneId = null;
    let activeRoomId = null;
    
    function initActiveContext() {
        try {
            const cfg =
                typeof window.getConfig === "function"
                    ? window.getConfig()
                    : window.config || null;
            const activeId =
                typeof window.getActiveEnseigne === "function"
                    ? window.getActiveEnseigne()
                    : cfg && cfg.lieux && cfg.lieux.active;
            const ens =
                cfg && cfg.lieux && Array.isArray(cfg.lieux.enseignes)
                    ? cfg.lieux.enseignes.find((e) => e.id === activeId)
                    : null;
            
            activeEnseigneId = ens ? ens.id : null;
            activeEnseigneName = ens ? ens.nom || ens.id : null;
            
            // room: try selected tab with data-room-id
            const tab = document.querySelector("#room-tabs .room-tab.active");
            const roomId = tab ? tab.getAttribute("data-room-id") : null;
            const piece = ens && ens.pieces && roomId 
                ? ens.pieces.find(p => p.id === roomId)
                : (ens && ens.pieces && ens.pieces[0]);
            
            activeRoomId = piece ? piece.id : null;
            activeRoomName = piece ? piece.nom || piece.id : null;
        } catch (e) { 
            console.error('[alerts-engine] initActiveContext error:', e);
        }
    }
    document.addEventListener("roomChanged", (ev) => {
        try {
            const cfg =
                typeof window.getConfig === "function"
                    ? window.getConfig()
                    : window.config || null;
            const activeId =
                typeof window.getActiveEnseigne === "function"
                    ? window.getActiveEnseigne()
                    : cfg && cfg.lieux && cfg.lieux.active;
            const ens =
                cfg && cfg.lieux && Array.isArray(cfg.lieux.enseignes)
                    ? cfg.lieux.enseignes.find((e) => e.id === activeId)
                    : null;
            const piece =
                ens && ens.pieces
                    ? ens.pieces.find((p) => p.id === ev.detail.roomId)
                    : null;
            
            activeEnseigneId = ens ? ens.id : activeEnseigneId;
            activeEnseigneName = ens ? ens.nom || ens.id : activeEnseigneName;
            activeRoomId = piece ? piece.id : activeRoomId;
            activeRoomName = piece ? piece.nom || piece.id : activeRoomName;
            
            // Régénérer les alert-points pour la nouvelle pièce
            if (activeEnseigneId && activeRoomId) {
                renderAlertPoints(activeEnseigneId, activeRoomId);
            }
            
            // Rafraîchir immédiatement les alertes
            fetchLatestIAQ();
        } catch (e) { 
            console.error('[alerts-engine] roomChanged error:', e);
        }
    });

    document.addEventListener("enseigneChanged", (ev) => {
        try {
            initActiveContext();
            
            // Régénérer les alert-points pour la nouvelle enseigne
            if (activeEnseigneId && activeRoomId) {
                renderAlertPoints(activeEnseigneId, activeRoomId);
            }
            
            // Rafraîchir immédiatement les alertes
            fetchLatestIAQ();
        } catch (e) { 
            console.error('[alerts-engine] enseigneChanged error:', e);
        }
    });

    async function fetchLatestIAQ() {
        try {
            if (!activeEnseigneName || !activeRoomName) initActiveContext();
            const params = new URLSearchParams({
                enseigne: activeEnseigneName || "",
                salle: activeRoomName || "",
                hours: "1",
                step: "5min",
            });
            const url = `${API_URL_DATA}?${params.toString()}`;
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
                applyAlertPointsActivation({}, {});
                return;
            }
            data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const last = data[data.length - 1];
            latestSample = last;
            try { window.latestIAQLastSample = last; } catch(e){}
            const map = deriveAlertPointSeverities(last || {});
            // Build recommended actions per alert-point key
            const suggestActionFor = (key, sev, last) => {
                const t = Number(last.temperature);
                const h = Number(last.humidity);
                const co2 = Number(last.co2);
                const pm = Number(last.pm25);
                const tvoc = Number(last.tvoc);
                // defaults by device
                switch (key) {
                    case 'window':
                        // CO2 élevé => ouvrir; PM2.5 élevé sans CO2 => fermer; humidité élevée => ouvrir; humidité basse => fermer; trop chaud => ouvrir; trop froid => fermer
                        if (!isNaN(pm) && pm >= THRESHOLDS.PM25.DANGER && (isNaN(co2) || co2 < THRESHOLDS.CO2.WARNING)) return 'close';
                        if (!isNaN(h) && h < THRESHOLDS.HUM.ACTION_TOO_DRY) return 'close';
                        if (!isNaN(t) && t < THRESHOLDS.TEMP.ACTION_COLD) return 'close';
                        return 'open';
                    case 'door':
                        // CO2 élevé => ouvrir; sinon fermer par défaut
                        if (!isNaN(co2) && co2 >= THRESHOLDS.CO2.WARNING) return 'open';
                        return 'close';
                    case 'ventilation':
                        // CO2/TVOC/PM élevés ou humidité élevée => allumer/augmenter; humidité trop basse => réduire/éteindre
                        if ((!isNaN(co2) && co2 >= THRESHOLDS.CO2.WARNING)
                            || (!isNaN(tvoc) && tvoc >= THRESHOLDS.TVOC.WARNING)
                            || (!isNaN(pm) && pm >= THRESHOLDS.PM25.WARNING_MED)
                            || (!isNaN(h) && h > THRESHOLDS.HUM.ACTION_TOO_HUMID)) return 'turn_on';
                        if (!isNaN(h) && h < THRESHOLDS.HUM.ACTION_TOO_DRY) return 'turn_off';
                        return 'turn_on';
                    case 'radiator':
                        // Trop froid => augmenter; trop chaud => diminuer
                        if (!isNaN(t) && t < THRESHOLDS.TEMP.ACTION_COLD) return 'increase';
                        if (!isNaN(t) && t > THRESHOLDS.TEMP.ACTION_HOT) return 'decrease';
                        return 'decrease';
                    case 'temperature':
                        if (!isNaN(t) && t < THRESHOLDS.TEMP.ACTION_COLD) return 'increase';
                        if (!isNaN(t) && t > THRESHOLDS.TEMP.ACTION_HOT) return 'decrease';
                        return 'decrease';
                    case 'humidity':
                        if (!isNaN(h) && h < THRESHOLDS.HUM.ACTION_TOO_DRY) return 'close'; // fermer fenêtres pour conserver l'humidité
                        if (!isNaN(h) && h > THRESHOLDS.HUM.ACTION_OPEN_THRESHOLD) return 'open';
                        return 'open';
                    default:
                        return 'turn_on';
                }
            };
            const actionsMap = {};
            Object.keys(map).forEach((key) => { actionsMap[key] = suggestActionFor(key, map[key], last); });
            applyAlertPointsActivation(map, actionsMap);
            // Notifications push locales (UI) pour danger (et warning optionnel)
            try {
                const t = (window.i18n && window.i18n.t) ? window.i18n.t : (k=>k);
                const notify = (sev, label, value) => {
                    if (typeof window.showNotification !== 'function') return;
                    const keyBase = sev === 'danger' ? 'notifications.alert.danger' : 'notifications.alert.warning';
                    // Fallback si clé absente
                    const sevTxt = sev === 'danger' ? (t('severity.danger') || 'Danger') : (t('severity.warning') || 'Avertissement');
                    const msg = `${sevTxt}: ${label} = ${value}`;
                    window.showNotification(msg, sev === 'danger');
                };
                const tempSev = evalTemp(Number(last.temperature));
                const humSev = evalHum(Number(last.humidity));
                if ((tempSev === 'danger' || tempSev === 'warning') && tempSev !== lastNotified.temp) {
                    notify(tempSev, t('digitalTwin.sample.temperature') || 'Température', last.temperature);
                    lastNotified.temp = tempSev;
                }
                if ((humSev === 'danger' || humSev === 'warning') && humSev !== lastNotified.hum) {
                    notify(humSev, t('digitalTwin.sample.humidity') || 'Humidité', last.humidity);
                    lastNotified.hum = humSev;
                }
            } catch(e) {}
        } catch (e) {
            // on error, do not modify current activation state
            // console.warn('alerts-engine fetch error', e);
        }
    }

    async function start() {
        // Attendre que la config soit chargée
        try {
            if (typeof window.loadConfig === 'function') {
                await window.loadConfig();
            }
        } catch (e) {
            console.warn('[alerts-engine] Could not load config:', e);
        }
        
        // Petit délai pour laisser tabs-manager s'initialiser
        await new Promise(resolve => setTimeout(resolve, 100));
        
        initActiveContext();
        
        // Attendre le premier roomChanged pour être sûr que le contexte est correctement restauré
        let isFirstLoad = true;
        const handleFirstRoomChange = () => {
            if (isFirstLoad) {
                isFirstLoad = false;
                fetchLatestIAQ();
                setInterval(fetchLatestIAQ, REFRESH_MS);
            }
        };
        
        // Écouter le premier roomChanged
        document.addEventListener('roomChanged', handleFirstRoomChange, { once: true });
        
        // Fallback: si aucun roomChanged après 1 seconde, démarrer quand même
        setTimeout(() => {
            if (isFirstLoad) {
                // Générer les alert-points pour la pièce active
                if (activeEnseigneId && activeRoomId) {
                    renderAlertPoints(activeEnseigneId, activeRoomId);
                }
                handleFirstRoomChange();
            }
        }, 1000);
    }

    if (typeof window !== "undefined") {
        document.addEventListener("DOMContentLoaded", start);
    }
})(window);
