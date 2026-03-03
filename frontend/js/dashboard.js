/**
 * Script spécifique pour la page Dashboard (index.html)
 */

function t(key) {
  if (window.i18n && typeof window.i18n.t === "function") {
    return window.i18n.t(key);
  }
  return null;
}

function resolveSelectedContext(config, enseigneId, salleId) {
  const enseigne = config?.lieux?.enseignes?.find((e) => e.id === enseigneId);
  const salle = enseigne?.pieces?.find((p) => p.id === salleId);

  if (!enseigne || !salle) return null;

  return {
    enseigne,
    salle,
    enseigneNom: enseigne.nom,
    salleNom: salle.nom,
  };
}

/**
 * Met à jour les graphiques en fonction de l'enseigne et de la salle sélectionnées
 * @param {string} enseigneId - L'ID de l'enseigne
 * @param {string} salleId - L'ID de la salle
 */
function updateCharts(enseigneId, salleId) {
  const config = getConfig();
  const ctx = resolveSelectedContext(config, enseigneId, salleId);

  // ⚙️ Utilise les noms (Maison, Salon) pour l'API
  currentEnseigne = ctx?.enseigneNom || enseigneId;
  currentSalle = ctx?.salleNom || salleId;

  // Recharge les données et met à jour les graphiques
  if (typeof window.resetCharts === "function") {
    window.resetCharts();
  }
  if (typeof window.fetchAndUpdate === "function") {
    window.fetchAndUpdate();
  }

  // Mettre à jour le score prédit
  console.log(
    `[dashboard] Updating predicted score for ${enseigneId}/${salleId}`,
  );
  fetchAndDisplayPredictedScore(enseigneId, salleId);
}

// Verrou anti-doublons : si un appel est déjà en cours, on attend son résultat
let _scoreInFlight = null;
let _scoreCache = null;  // { key, ts, score, trend }
const SCORE_CACHE_TTL_MS = 15_000;  // 15 secondes

/**
 * Récupère et affiche le score prédit pour la salle courante.
 * Essaie d'abord /api/predict/score, puis /api/predict/preventive-actions en fallback.
 * Dé-doublonne les appels simultanés avec un verrou et un cache court-terme.
 */
async function fetchAndDisplayPredictedScore(enseigneId, salleId) {
  const scoreElement = document.getElementById("predicted-score-value");
  const trendElement = document.getElementById("predicted-score-trend");

  if (!scoreElement) {
    console.warn("[dashboard] Predicted score element not found");
    return;
  }

  try {
    const config = getConfig();
    if (!config) {
      console.warn("[dashboard] Config not ready yet");
      return;
    }

    const ctx = resolveSelectedContext(config, enseigneId, salleId);
    if (!ctx) {
      console.warn(`[dashboard] Could not find enseigne/salle for ${enseigneId}/${salleId}`);
      return;
    }

    const { enseigneNom, salleNom } = ctx;
    const cacheKey = `${enseigneNom}|${salleNom}`;

    // --- Cache court-terme (15s) : évite les appels redondants sur tick rapide ---
    if (_scoreCache && _scoreCache.key === cacheKey && (Date.now() - _scoreCache.ts) < SCORE_CACHE_TTL_MS) {
      console.debug(`[dashboard] Score cache HIT pour ${cacheKey}`);
      _applyScoreToDOM(scoreElement, trendElement, _scoreCache.score, _scoreCache.trend);
      return;
    }

    // --- Verrou anti-doublon : plusieurs appelants simultanés partagent la même Promise ---
    if (_scoreInFlight && _scoreInFlight.key === cacheKey) {
      console.debug(`[dashboard] Score already in-flight pour ${cacheKey}, en attente...`);
      const { score, trend } = await _scoreInFlight.promise;
      _applyScoreToDOM(scoreElement, trendElement, score, trend);
      return;
    }

    let resolveInFlight;
    _scoreInFlight = {
      key: cacheKey,
      promise: new Promise((res) => { resolveInFlight = res; })
    };

    let predictedScore = null;
    let trendValue = "";

    // --- Tentative 1 : /api/predict/score (endpoint dédié, plus léger) ---
    try {
      const headers = {};
      if (typeof getAuthToken === "function") {
        const token = await getAuthToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }
      const scoreUrl = `${API_ENDPOINTS.predictScore}?enseigne=${encodeURIComponent(enseigneNom)}&salle=${encodeURIComponent(salleNom)}`;
      console.log(`[dashboard] Fetching predictScore: ${scoreUrl}`);
      const resp = await fetch(scoreUrl, { headers });
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.predicted_score === "number") {
          predictedScore = data.predicted_score;
          trendValue = data.trend || data.predicted_level || "";
        }
      }
    } catch (e) {
      console.warn("[dashboard] /predict/score failed, trying fallback...", e.message);
    }

    // --- Tentative 2 : /api/predict/preventive-actions (fallback) ---
    if (predictedScore === null) {
      try {
        const params = new URLSearchParams({ enseigne: enseigneNom, salle: salleNom });
        const url = `${API_ENDPOINTS.preventiveActions}?${params}`;
        console.log(`[dashboard] Trying preventiveActions fallback: ${url}`);
        const response = await fetchWithRetry(url, {}, 1);
        if (response.ok) {
          const data = await response.json();
          const ps = data.status && data.status.predicted_score !== undefined
            ? data.status.predicted_score : data.predicted_score;
          if (ps !== undefined && ps !== null) {
            predictedScore = ps;
          }
        }
      } catch (e2) {
        console.warn("[dashboard] /preventive-actions fallback also failed:", e2.message);
      }
    }

    // Mettre en cache et résoudre le verrou
    _scoreCache = { key: cacheKey, ts: Date.now(), score: predictedScore, trend: trendValue };
    resolveInFlight({ score: predictedScore, trend: trendValue });
    _scoreInFlight = null;

    _applyScoreToDOM(scoreElement, trendElement, predictedScore, trendValue);

  } catch (error) {
    console.error("[dashboard] Error fetching predicted score:", error);
    _scoreInFlight = null;
    scoreElement.textContent = "—";
    scoreElement.style.color = "";
  }
}

/** Applique un score prédit au DOM */
function _applyScoreToDOM(scoreElement, trendElement, predictedScore, trendValue) {
  if (predictedScore !== null && typeof predictedScore === "number") {
    const roundedScore = Math.round(predictedScore);
    scoreElement.textContent = roundedScore;
    scoreElement.style.color =
      roundedScore >= 81 ? "#10b981" :
      roundedScore >= 61 ? "#84cc16" :
      roundedScore >= 41 ? "#f59e0b" :
      roundedScore >= 21 ? "#f97316" : "#ef4444";
    if (trendElement) {
      let label = trendValue || "";
      if (typeof label === "string" && label.trim()) {
        const levelKey = label.trim().toLowerCase();
        const translated =
          t(`airQualityStates.${levelKey}`) ||
          t(`dashboard.score.${levelKey}`);
        if (translated) {
          label = translated;
        }
      }
      trendElement.textContent = label;
    }
  } else {
    scoreElement.textContent = "—";
    scoreElement.style.color = "";
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

let currentDashboardEnseigneId = null;
let currentDashboardSalleId = null;

// Écouter les changements de pièce pour mettre à jour les graphiques
document.addEventListener("roomChanged", (event) => {
  const { roomId, enseigneId } = event.detail;
  currentDashboardEnseigneId = enseigneId;
  currentDashboardSalleId = roomId;
  updateCharts(enseigneId, roomId);
});

// Écouter les ticks de mesures (toutes les 6 mesures) pour actualiser le score
document.addEventListener("predictScoreTick", () => {
  if (currentDashboardEnseigneId && currentDashboardSalleId) {
    fetchAndDisplayPredictedScore(currentDashboardEnseigneId, currentDashboardSalleId);
  }
});

// Export des fonctions
window.openModal = openModal;
window.closeModal = closeModal;
window.updateCharts = updateCharts;
window.fetchAndDisplayPredictedScore = fetchAndDisplayPredictedScore;
