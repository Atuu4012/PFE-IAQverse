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
  if (
    !forceRefresh &&
    !panel.classList.contains("hidden") &&
    currentDetailsSubject === sujet
  ) {
    panel.classList.add("hidden");
    list.innerHTML = "";
    currentDetailsSubject = null;

    // Forcer le resize du canvas 3D et du container après fermeture du panel
    setTimeout(() => {
      const twinLayout = document.querySelector(".twin-layout");
      if (twinLayout) {
        twinLayout.style.gridTemplateRows = "auto"; // Réinitialiser les lignes
      }
      window.dispatchEvent(new Event("resize"));
    }, 50);
    return;
  }

  panel.classList.remove("hidden");
  list.innerHTML = "";
  currentDetailsSubject = sujet;

  // Forcer le resize du canvas 3D et du container après ouverture du panel
  setTimeout(() => {
    const twinLayout = document.querySelector(".twin-layout");
    if (twinLayout) {
      twinLayout.style.gridTemplateRows = "auto auto"; // Deux lignes actives
    }
    window.dispatchEvent(new Event("resize"));
  }, 50);

  // Mettre à jour le titre avec le sujet
  const subjectSpan = document.getElementById("details-subject");
  if (subjectSpan) {
    subjectSpan.textContent = sujet ? `(${sujet})` : "";
  }

  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;

  // Icônes par paramètre (alignées avec les graphiques)
  // Codes de paramètre pour appliquer une couleur dédiée via CSS (pas d'emoji)
  const knownParams = new Set([
    "co2",
    "pm25",
    "tvoc",
    "temperature",
    "humidity",
  ]);

  // Helper pour formatter un item de détail avec style riche
  const formatNumber = (num, decimals = 2) => {
    // Accept number or numeric string
    const n =
      typeof num === "number"
        ? num
        : typeof num === "string"
          ? Number(num)
          : NaN;
    if (Number.isNaN(n)) return num; // return original if not numeric
    // To avoid unnecessary trailing zeros, use Number to normalize
    return Number(n.toFixed(decimals));
  };

  const formatIssue = (it) => {
    if (!it) return null;
    const dirTxt =
      it.direction === "low"
        ? t("digitalTwin.details.low") || "trop bas"
        : it.direction === "high"
          ? t("digitalTwin.details.high") || "trop élevé"
          : t("digitalTwin.details.out_of_range") || "hors plage";

    // Translate parameter name using i18n
    const paramCode = (it.code || "").toLowerCase();
    const paramName =
      t(`digitalTwin.details.parameters.${paramCode}`) ||
      it.name ||
      it.code ||
      "Paramètre";

    const unit = it.unit ? ` ${it.unit}` : "";
    const thresholdLabel =
      it.direction === "low"
        ? t("digitalTwin.details.thresholdMin") || "seuil min"
        : t("digitalTwin.details.thresholdMax") || "seuil max";
    const thrTxt =
      typeof it.threshold === "number"
        ? ` <span class="param-threshold">(${thresholdLabel} : ${formatNumber(it.threshold)}${unit})</span>`
        : "";
    const displayedValue =
      typeof it.value === "number" ? formatNumber(it.value) : it.value;
    return {
      html: `<span class="param-value">${paramName} ${dirTxt} : ${displayedValue}${unit}</span>${thrTxt}`,
      severity: it.severity || "info",
      code: paramCode,
    };
  };

  const issues = detail && Array.isArray(detail.issues) ? detail.issues : [];
  const hasIssues = issues.length > 0;

  if (hasIssues) {
    // Afficher toutes les issues (danger, warning ET info)
    issues.forEach((it) => {
      const li = document.createElement("li");
      const formatted = formatIssue(it);
      if (formatted) {
        li.innerHTML = formatted.html;
        const sevClass =
          formatted.severity === "danger"
            ? "issue-danger"
            : formatted.severity === "warning"
              ? "issue-warning"
              : "issue-info";
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
      const li = document.createElement("li");
      li.className = "issue-action";
      const actionLabel = t && t(`digitalTwin.actionVerbs.${actionKey}`);
      li.innerHTML = `<strong>${(t && t("digitalTwin.tip.recommendedAction")) || "Action recommandée"} :</strong> ${actionLabel || actionKey}`;
      list.appendChild(li);
    }
  } else {
    // Pas de problème détecté - tout va bien
    const li = document.createElement("li");
    li.className = "issue-info";
    li.innerHTML = `<span class="param-value">${t("digitalTwin.tip.allGood") || "Tous les paramètres sont dans les normes"}</span>`;
    list.appendChild(li);
  }
}

/**
 * Gestion de la modale d'info
 */
function openModal() {
  ModalManager.open("infoModal");
}

function closeModal() {
  ModalManager.close("infoModal");
}

function closeDetailsPanel() {
  const panel = document.getElementById("details-panel");
  if (panel && !panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    const list = document.getElementById("details-list");
    if (list) list.innerHTML = "";
    currentDetailsSubject = null;
  }
}
window.closeDetailsPanel = closeDetailsPanel;

// Écouter les changements de pièce pour charger le modèle 3D
document.addEventListener("roomChanged", (event) => {
  const { roomId } = event.detail;
  if (typeof window.loadPieceModel === "function") {
    window.loadPieceModel(roomId);
  }
  try {
    syncAlertPointsToTable();
  } catch (e) {}

  // Fermer le panneau de détails lors du changement de pièce
  closeDetailsPanel();
});

document.addEventListener("enseigneChanged", () => {
  try {
    syncAlertPointsToTable();
  } catch (e) {}

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
  const label = document.querySelector(".room-label");
  if (!label) return;

  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;

  // Compter uniquement les alert-points actifs avec sévérité danger (points rouges)
  const activeAlerts = document.querySelectorAll(
    '.alert-point[data-active="true"][data-severity="danger"]',
  );
  const count = activeAlerts.length;

  let text;
  if (count === 0) {
    text = t("digitalTwin.alertCount.zero") || "Aucune alerte";
  } else if (count === 1) {
    text = t("digitalTwin.alertCount.one") || "1 Alerte";
  } else {
    const template =
      t("digitalTwin.alertCount.multiple") || "{{count}} Alertes";
    text = template.replace("{{count}}", count);
  }

  label.textContent = text;
}

// Exporter la fonction pour qu'elle soit accessible depuis alerts-engine
window.updateAlertCountLabel = updateAlertCountLabel;

/**
 * Récupère et affiche le score prédit dans le panneau préventif
 */
async function fetchAndDisplayPreventiveScore(params) {
  const scoreElement = document.getElementById("preventive-score-value");
  const trendElement = document.getElementById("preventive-score-trend");
  const containerElement = document.getElementById(
    "preventive-predicted-score",
  );

  if (!scoreElement || !trendElement || !containerElement) return;

  try {
    const response = await fetchWithRetry(
      `${API_ENDPOINTS.preventiveActions}?${params}`,
      {},
      1,
    );
    const data = await response.json();

    // Support both structures
    const predictedScore =
      data.status && data.status.predicted_score !== undefined
        ? data.status.predicted_score
        : data.predicted_score;

    if (predictedScore !== undefined) {
      const roundedScore = Math.round(predictedScore);
      scoreElement.textContent = roundedScore;

      containerElement.classList.remove(
        "predicted-a",
        "predicted-b",
        "predicted-c",
        "predicted-d",
        "predicted-e",
      );
      if (roundedScore >= 81) {
        containerElement.classList.add("predicted-a");
      } else if (roundedScore >= 61) {
        containerElement.classList.add("predicted-b");
      } else if (roundedScore >= 41) {
        containerElement.classList.add("predicted-c");
      } else if (roundedScore >= 21) {
        containerElement.classList.add("predicted-d");
      } else {
        containerElement.classList.add("predicted-e");
      }

      if (window.scoreHistory && window.scoreHistory.length > 0) {
        const lastScore = window.scoreHistory[window.scoreHistory.length - 1];
        const diff = roundedScore - lastScore;
        if (diff > 2) {
          trendElement.textContent = "↗";
          trendElement.className = "predicted-trend up";
        } else if (diff < -2) {
          trendElement.textContent = "↘";
          trendElement.className = "predicted-trend down";
        } else {
          trendElement.textContent = "→";
          trendElement.className = "predicted-trend stable";
        }
      } else {
        trendElement.textContent = "";
        trendElement.className = "predicted-trend";
      }
    }
  } catch (error) {
    console.error("[preventive] Error fetching score:", error);
    scoreElement.textContent = "—";
  }
}

/**
 * Récupère et affiche les actions préventives depuis l'API
 */
async function fetchAndDisplayPreventiveActions() {
  const container = document.getElementById("preventive-actions-container");
  if (!container) return;

  try {
    const cfg =
      typeof window.getConfig === "function"
        ? window.getConfig()
        : window.config || null;
    const activeEnseigneId =
      typeof window.getActiveEnseigne === "function"
        ? window.getActiveEnseigne()
        : cfg && cfg.lieux && cfg.lieux.active;

    const tab = document.querySelector("#room-tabs .room-tab.active");
    let activeRoomId = tab ? tab.getAttribute("data-room-id") : null;

    if (!activeEnseigneId || !activeRoomId) return;

    const ens = cfg?.lieux?.enseignes?.find((e) => e.id === activeEnseigneId);
    const salle = ens?.pieces?.find((p) => p.id === activeRoomId);
    if (!ens || !salle) return;

    const params = new URLSearchParams({
      enseigne: ens.nom || "Maison",
      salle: salle.nom || "",
    });
    const url = `${API_ENDPOINTS.preventiveActions}?${params}`;
    const response = await fetchWithRetry(url, {}, 2);
    const data = await response.json();

    // Réutiliser les données déjà récupérées pour mettre à jour le score prédit
    // au lieu de refaire une requête identique
    try {
      const predictedScore =
        data.status && data.status.predicted_score !== undefined
          ? data.status.predicted_score
          : data.predicted_score;

      if (predictedScore !== undefined) {
        const scoreElement = document.getElementById("preventive-score-value");
        const trendElement = document.getElementById("preventive-score-trend");
        const containerElement = document.getElementById("preventive-predicted-score");

        if (scoreElement && containerElement) {
          const roundedScore = Math.round(predictedScore);
          scoreElement.textContent = roundedScore;

          containerElement.classList.remove("predicted-a", "predicted-b", "predicted-c", "predicted-d", "predicted-e");
          if (roundedScore >= 81) containerElement.classList.add("predicted-a");
          else if (roundedScore >= 61) containerElement.classList.add("predicted-b");
          else if (roundedScore >= 41) containerElement.classList.add("predicted-c");
          else if (roundedScore >= 21) containerElement.classList.add("predicted-d");
          else containerElement.classList.add("predicted-e");

          if (trendElement && window.scoreHistory && window.scoreHistory.length > 0) {
            const lastScore = window.scoreHistory[window.scoreHistory.length - 1];
            const diff = roundedScore - lastScore;
            if (diff > 2) { trendElement.textContent = "↗"; trendElement.className = "predicted-trend up"; }
            else if (diff < -2) { trendElement.textContent = "↘"; trendElement.className = "predicted-trend down"; }
            else { trendElement.textContent = "→"; trendElement.className = "predicted-trend stable"; }
          }
        }
      }
    } catch (e) {
      console.warn("[preventive] Score extraction failed:", e);
    }
    displayPreventiveActions(data);
  } catch (error) {
    console.error("[preventive] Error fetching actions:", error);
    container.innerHTML = `<div class="preventive-error">
            ⚠️ Service de prédiction temporairement indisponible.<br>
            <small>Les données seront rechargées automatiquement.</small>
        </div>`;
  }
}

/**
 * Affiche les actions préventives dans le conteneur
 */
function displayPreventiveActions(data) {
  const container = document.getElementById("preventive-actions-container");
  if (!container) return;

  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;

  console.log("[displayPreventiveActions] Received data:", data);
  console.log(
    "[displayPreventiveActions] Actions type:",
    typeof data.actions,
    "isArray:",
    Array.isArray(data.actions),
  );

  if (
    data.error ||
    !data.actions ||
    !Array.isArray(data.actions) ||
    data.actions.length === 0
  ) {
    container.innerHTML = `
            <div class="preventive-empty">
                <span class="preventive-icon"></span>
                <p>${t("digitalTwin.preventive.no_actions") || "Aucune action préventive nécessaire. La qualité de l'air restera bonne."}</p>
            </div>
        `;
    return;
  }

  const deviceI18nMap = {
    window: "window",
    ventilation: "ventilation",
    air_conditioning: "air_conditioning",
    radiator: "radiator",
  };

  const actionI18nMap = {
    open: "open",
    close: "close",
    turn_on: "turn_on",
    turn_off: "turn_off",
    increase: "increase",
    decrease: "decrease",
  };

  let html = "";
  data.actions.forEach((action) => {
    // HIDE ACTION IF COMPLETED
    // Check if matching module is already in the requested state
    try {
      const deviceType = action.device;
      // Map action to state
      const targetStates =
        action.action === "open" || action.action === "turn_on"
          ? ["open", "on"]
          : ["closed", "off"];

      // Find active alert points in DOM that match this device type
      // Note: This relies on three-scene.js having rendered the points and updated their data-state
      const allPoints = Array.from(document.querySelectorAll(".alert-point"));
      const matchingPoints = allPoints.filter(
        (pt) => pt.getAttribute("data-i18n-key") === deviceType,
      );

      if (matchingPoints.length > 0) {
        // If any of the matching devices is in the target state, consider it handled?
        // Or we might want to check specific IDs if ML returned them.
        // For now, if ML says "Open Window" and we have opened A window, we hide it.
        const isCompleted = matchingPoints.some((pt) =>
          targetStates.includes(pt.getAttribute("data-state")),
        );
        if (isCompleted) return; // SKIP this action
      }
    } catch (e) {
      console.warn("Error filtering preventive actions", e);
    }

    const deviceKey = deviceI18nMap[action.device] || action.device;
    const deviceName =
      (t && t(`digitalTwin.sample.${deviceKey}.subject`)) || action.device;

    const actionKey = actionI18nMap[action.action] || action.action;
    const actionVerb =
      (t && t(`digitalTwin.actionVerbs.${actionKey}`)) || action.action;

    const priorityEmoji =
      {
        high: "",
        medium: "",
        low: "",
      }[action.priority] || "";

    const priorityLabel =
      {
        high: "Urgent",
        medium: "Recommandé",
        low: "Optionnel",
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
                        <span class="value-arrow">${t("digitalTwin.preventive.arrow") || "→"}</span>
                        <span class="value-predicted">${action.predicted_value || action.current_value} ${action.unit}</span>
                        ${
                          action.change_percent !== undefined
                            ? `<span class="value-percent ${action.change_percent > 0 ? "increasing" : "decreasing"}">
                                (${action.change_percent > 0 ? "+" : ""}${action.change_percent.toFixed(1)}%)
                            </span>`
                            : ""
                        }
                    </div>
                    ${
                      action.trend
                        ? `<div class="value-row trend-row">
                        <span class="trend-indicator trend-${action.trend}">
                            ${action.trend === "increasing" ? "📈 En augmentation" : action.trend === "decreasing" ? "📉 En diminution" : "➡️ Stable"}
                        </span>
                    </div>`
                        : ""
                    }
                    ${
                      action.forecast_minutes
                        ? `<div class="value-row forecast-row">
                        <span class="forecast-time">⏱️ Prévision à ${action.forecast_minutes} min</span>
                    </div>`
                        : ""
                    }
                    ${
                      action.is_ml_action
                        ? `<div class="value-row ml-row">
                        <span class="ml-badge">🤖 Prédiction ML</span>
                    </div>`
                        : ""
                    }
                </div>
            </div>
        `;
  });

  container.innerHTML = html;
}

// Sync alert-point elements into the actions table as rows
window.syncAlertPointsToTable = function syncAlertPointsToTable() {
  const tbody = document.querySelector(".actions-table tbody");
  if (!tbody) {
    console.warn("[digital-twin] Actions table tbody not found");
    return;
  }

  // Vérifier si le panneau de détails est ouvert et stocker le sujet actuel
  const panel = document.getElementById("details-panel");
  const isPanelOpen = panel && !panel.classList.contains("hidden");
  const previousSubject = currentDetailsSubject;

  // Get active context (enseigne + salle)
  const getActiveContext = () => {
    try {
      const cfg =
        typeof window.getConfig === "function"
          ? window.getConfig()
          : window.config || null;
      const activeEnseigneId =
        typeof window.getActiveEnseigne === "function"
          ? window.getActiveEnseigne()
          : cfg && cfg.lieux && cfg.lieux.active;

      // Essayer de récupérer activeRoomId depuis le tab actif
      const tab = document.querySelector("#room-tabs .room-tab.active");
      let activeRoomId = tab ? tab.getAttribute("data-room-id") : null;

      // Si pas de tab actif, prendre la première pièce de l'enseigne active
      if (!activeRoomId && cfg && cfg.lieux && cfg.lieux.enseignes) {
        const ens = cfg.lieux.enseignes.find((e) => e.id === activeEnseigneId);
        if (ens && ens.pieces && ens.pieces.length > 0) {
          activeRoomId = ens.pieces[0].id;
        }
      }

      return { activeEnseigneId, activeRoomId };
    } catch (e) {
      console.error("[digital-twin] Error getting active context:", e);
      return { activeEnseigneId: null, activeRoomId: null };
    }
  };

  const { activeEnseigneId, activeRoomId } = getActiveContext();

  // Only include active alert points that belong to the current enseigne/salle
  const allActivePoints = Array.from(
    document.querySelectorAll('.alert-point[data-active="true"]'),
  );

  const points = allActivePoints.filter((pt) => {
    const ptEnseigne = pt.getAttribute("data-enseigne");
    const ptPiece = pt.getAttribute("data-piece");
    return ptEnseigne === activeEnseigneId && ptPiece === activeRoomId;
  });

  if (!points || points.length === 0) {
    // Clear all dynamic alerts if no points
    Array.from(tbody.querySelectorAll("tr.dynamic-alert")).forEach((r) =>
      r.remove(),
    );
    // Mettre à jour le compteur d'alertes
    if (typeof window.updateAlertCountLabel === "function")
      window.updateAlertCountLabel();
    return;
  }

  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;

  // Grouper les points par target-names
  const pointsByTarget = {};
  points.forEach((pt) => {
    const explicitKey = pt.getAttribute("data-i18n-key");
    const targetName = pt.getAttribute("data-target-names");
    if (!explicitKey || !targetName) return;

    if (!pointsByTarget[targetName]) {
      pointsByTarget[targetName] = {
        type: explicitKey,
        targetName: targetName,
        points: [],
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

  const currentRows = new Map();
  Array.from(tbody.querySelectorAll("tr.dynamic-alert")).forEach((tr) => {
    const id = tr.getAttribute("data-target-id");
    if (id) currentRows.set(id, tr);
  });

  const builtRows = [];
  const processedIds = new Set();

  // Traiter chaque objet distinct (par targetName)
  Object.entries(pointsByTarget).forEach(([targetName, group]) => {
    const typeKey = group.type;
    const typePoints = group.points;
    const rowId = `row-${targetName}`;
    processedIds.add(rowId);

    // --- LOGIQUE D'ÉTAT ---
    // Déterminer l'emoji basé sur l'état
    const states = typePoints.map((pt) => {
      const state = pt.getAttribute("data-state");
      if (state) return state;
      const severity = pt.getAttribute("data-severity");
      if (severity === "info") {
        const key = pt.getAttribute("data-i18n-key");
        return key === "door" || key === "window" ? "open" : "on";
      } else {
        const key = pt.getAttribute("data-i18n-key");
        return key === "door" || key === "window" ? "closed" : "off";
      }
    });
    const hasClosedOrOff = states.some((s) => s === "closed" || s === "off");
    // REMPLACÉ: Utilisation d'indicateurs CSS au lieu d'emojis

    // Déterminer la classe CSS basée sur la gravité
    const severities = typePoints.map(
      (pt) => pt.getAttribute("data-severity") || "info",
    );
    const severityWeights = { danger: 0, warning: 1, info: 2 };
    const maxSeverity = severities.reduce(
      (max, sev) => (severityWeights[sev] < severityWeights[max] ? sev : max),
      "info",
    );
    const severityLower = maxSeverity.toLowerCase();
    const severityMap = {
      danger: { cls: "alert-red" },
      warning: { cls: "alert-yellow" },
      info: { cls: "alert-green" },
    };
    const sev = severityMap[severityLower] || severityMap["danger"];

    let tr = currentRows.get(rowId);

    const tdState = document.createElement("td");
    // NOUVEAU STYLE : Indicateur visuel
    const indicator = document.createElement("div");
    indicator.className = hasClosedOrOff
      ? "status-indicator status-red"
      : "status-indicator status-green";
    tdState.appendChild(indicator);

    // Utiliser le premier point pour les clés i18n et actions
    const firstPoint = typePoints[0];
    let actionKeyToCompare = firstPoint.getAttribute("data-action-key");
    if (!actionKeyToCompare) {
      const defaultActions = {
        window: "close",
        door: "close",
        ventilation: "turn_on",
        radiator: "decrease",
        air_conditioning: "turn_on",
        air_purifier: "turn_on",
      };
      actionKeyToCompare = defaultActions[typeKey];
    }

    let isSatisfied = false;
    if (actionKeyToCompare) {
      const currentState = hasClosedOrOff
        ? typeKey === "door" || typeKey === "window"
          ? "closed"
          : "off"
        : typeKey === "door" || typeKey === "window"
          ? "open"
          : "on";
      if (currentState === "open" && actionKeyToCompare === "open")
        isSatisfied = true;
      else if (currentState === "closed" && actionKeyToCompare === "close")
        isSatisfied = true;
      else if (
        currentState === "on" &&
        ["turn_on", "activate", "increase"].includes(actionKeyToCompare)
      )
        isSatisfied = true;
      else if (
        currentState === "off" &&
        ["turn_off", "deactivate", "decrease"].includes(actionKeyToCompare)
      )
        isSatisfied = true;
    }

    // Classe CSS finale
    let trClass = "dynamic-alert";
    if (isSatisfied) {
      trClass += " alert-success";
    } else {
      const severityMap = {
        danger: "alert-red",
        warning: "alert-yellow",
        info: "alert-green",
      };
      trClass += ` ${severityMap[severityLower] || "alert-green"}`;
    }

    // --- CONSTRUCTION / MISE À JOUR DU DOM ---
    if (!tr) {
      tr = document.createElement("tr");
      tr.setAttribute("data-target-id", rowId);

      // Create structure once
      const tdState = document.createElement("td");
      tdState.className = "col-state";
      const tdSubj = document.createElement("td");
      tdSubj.className = "col-subj";
      const tdAct = document.createElement("td");
      tdAct.className = "col-act";

      tr.appendChild(tdState);
      tr.appendChild(tdSubj);
      tr.appendChild(tdAct);

      // Add handler once
      tr.addEventListener("click", function () {
        const subj = this.querySelector(".col-subj").textContent.trim();
        showDetails(subj, this._detailsData);
      });
    }

    // Update Content
    tr.className = trClass;

    // Mise à jour de l'indicateur de statut (remplace stateEmoji)
    const colState = tr.querySelector(".col-state");
    if (colState) {
      let indicator = colState.querySelector(".status-indicator");
      // Si l'indicateur n'existe pas (ancienne ligne ou texte pur), on nettoie et on crée
      if (!indicator) {
        colState.textContent = "";
        indicator = document.createElement("div");
        colState.appendChild(indicator);
      }
      indicator.className = hasClosedOrOff
        ? "status-indicator status-red"
        : "status-indicator status-green";
    }

    // Prepare Texts
    const actionKeyDyn = firstPoint.getAttribute("data-action-key");
    const subjectKey = `digitalTwin.sample.${typeKey}.subject`;
    const actionKeyFallback = `digitalTwin.sample.${typeKey}.action`;

    let subjTxt = (t && t(subjectKey)) || typeKey;
    if (typeCount[typeKey] > 1) {
      const objectIndex = typeObjects[typeKey].indexOf(targetName) + 1;
      subjTxt = `${subjTxt} ${objectIndex}`;
    }

    const dynI18nKey = actionKeyDyn
      ? `digitalTwin.actionVerbs.${actionKeyDyn}`
      : null;
    const dynActTxt = dynI18nKey && t ? t(dynI18nKey) : null;
    const actTxtFallback = (t && t(actionKeyFallback)) || null;

    const tdSubj = tr.querySelector(".col-subj");
    tdSubj.setAttribute("data-i18n", subjectKey);
    // Warning: if we just set textContent, we lose the number suffix logic on re-translate.
    // For now, accept that re-translation might clear the number suffix unless we handle it in i18n lib.
    // Or we assume automatic translation won't happen every frame.
    if (tdSubj.textContent !== subjTxt) tdSubj.textContent = subjTxt;

    const tdAct = tr.querySelector(".col-act");
    const actContent = dynActTxt
      ? dynActTxt
      : actTxtFallback
        ? actTxtFallback
        : (t && t("digitalTwin.details")) || "Détails";
    if (actionKeyDyn) tdAct.setAttribute("data-i18n", dynI18nKey);
    else tdAct.setAttribute("data-i18n", actionKeyFallback);

    if (tdAct.textContent !== actContent) tdAct.textContent = actContent;

    // Details Data
    let combinedDetails = null;
    try {
      const raw = firstPoint.getAttribute("data-details");
      combinedDetails = raw ? JSON.parse(raw) : null;
    } catch (e) {
      combinedDetails = null;
    }
    tr._detailsData = combinedDetails;

    // Queue for sort
    let weight = severityWeights[severityLower];

    // Si la ligne est verte (succès), on la met tout en bas (poids plus élevé)
    if (tr.classList.contains("alert-success")) {
      weight = 10; // Poids élevé pour être à la fin
    }

    console.log(
      `[digital-twin] Adding grouped row for ${typeKey} with severity weight ${weight}`,
    );
    builtRows.push({ tr, weight });
  });

  // --- REMOVAL OF STALE ROWS ---
  currentRows.forEach((tr, id) => {
    if (!processedIds.has(id)) {
      tr.remove();
    }
  });

  // --- SORTING & REORDERING ---
  // Only re-append if order changed or new items
  builtRows.sort((a, b) => a.weight - b.weight);

  // Efficient Re-ordering
  builtRows.forEach(({ tr }) => {
    // Appending an existing child moves it to the end.
    // If we do this in sorted order, the DOM ends up sorted.
    // Check if it's already in position to avoid unnecessary paint
    if (tbody.lastElementChild !== tr) {
      tbody.appendChild(tr);
    }
  });

  // Remove naive _applyTranslations call to prevent text blinking/overwriting
  // try { if (window.i18n && typeof window.i18n._applyTranslations === 'function') window.i18n._applyTranslations(tbody); } catch(e){}

  // --- DETAILS PANEL SYNC ---
  if (isPanelOpen && previousSubject) {
    // Find if row for this subject still exists and get new details
    const found = builtRows.find((item) => {
      const sub = item.tr.querySelector(".col-subj");
      return sub && sub.textContent.trim() === previousSubject;
    });

    if (!found) {
      closeDetailsPanel();
    } else {
      // Update details content in real-time
      // Use forceRefresh=true to update even if subject is same
      showDetails(previousSubject, found.tr._detailsData, true);
    }
  }

  // Mettre à jour le compteur d'alertes
  if (typeof window.updateAlertCountLabel === "function") {
    window.updateAlertCountLabel();
  }
};

// run once on DOMContentLoaded and whenever language changes
document.addEventListener("DOMContentLoaded", () => {
  try {
    syncAlertPointsToTable();
    fetchAndDisplayPreventiveActions();
    // Rafraîchir les actions préventives toutes les 30 secondes
    setInterval(fetchAndDisplayPreventiveActions, 30000);
  } catch (e) {
    console.error("[digital-twin] Error in DOMContentLoaded:", e);
  }
});
window.addEventListener("language-changed", () => {
  try {
    syncAlertPointsToTable();
    fetchAndDisplayPreventiveActions();
  } catch (e) {}
});

// Rafraîchir les actions préventives lors du changement de pièce ou d'enseigne
document.addEventListener("roomChanged", () => {
  try {
    fetchAndDisplayPreventiveActions();
  } catch (e) {}
});
document.addEventListener("enseigneChanged", () => {
  try {
    fetchAndDisplayPreventiveActions();
  } catch (e) {}
});

// Listen for IAQ data updates to update the overlay
document.addEventListener("iaqDataUpdated", (event) => {
  const data = event.detail;
  if (!data) return;

  const updateElement = (id, value) => {
    const el = document.getElementById(id);
    if (el) {
      // Format numbers: 0 decimals for CO2, 1 for others
      let formatted = "--";
      if (value !== undefined && value !== null && !isNaN(value)) {
        const num = Number(value);
        if (id === "overlay-co2") {
          formatted = num.toFixed(0);
        } else {
          formatted = num.toFixed(1);
        }
      }
      el.textContent = formatted;
    }
  };

  updateElement("overlay-co2", data.co2);
  updateElement("overlay-pm25", data.pm25);
  updateElement("overlay-tvoc", data.tvoc);
  updateElement("overlay-temp", data.temperature);
  updateElement("overlay-hum", data.humidity);
});

// Legend Modal Functions
function openLegendModal() {
  const modal = document.getElementById("legendModal");
  if (modal) {
    modal.style.display = "flex"; // Use flex to center
    // Close when clicking outside
    window.onclick = function (event) {
      if (event.target == modal) {
        closeLegendModal();
      }
    };
  }
}

function closeLegendModal() {
  const modal = document.getElementById("legendModal");
  if (modal) {
    modal.style.display = "none";
  }
}

// Listener pour les mises à jour de configuration (ex: changement de paysage)
// Listen for config updates via the global WebSocket manager
document.addEventListener("DOMContentLoaded", () => {
  const setupConfigWs = () => {
    if (!window.wsManager) {
      setTimeout(setupConfigWs, 1000);
      return;
    }
    window.wsManager.on("config_updated", (data) => {
      if (data && data.config) {
        if (window.setConfig) window.setConfig(data.config);
        if (window.updateThreeEnvironment)
          window.updateThreeEnvironment(data.config);
      }
    });
  };
  setupConfigWs();
});
