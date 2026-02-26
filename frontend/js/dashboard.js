/**
 * Script spécifique pour la page Dashboard (index.html)
 */

/**
 * Met à jour les graphiques en fonction de l'enseigne et de la salle sélectionnées
 * @param {string} enseigneId - L'ID de l'enseigne
 * @param {string} salleId - L'ID de la salle
 */
function updateCharts(enseigneId, salleId) {
  const config = getConfig();

  // Cherche les objets correspondants dans la configuration
  const enseigne = config.lieux.enseignes.find((e) => e.id === enseigneId);
  const salle = enseigne?.pieces?.find((p) => p.id === salleId);

  // ⚙️ Utilise les noms (Maison, Salon) pour l'API
  currentEnseigne = enseigne?.nom || enseigneId;
  currentSalle = salle?.nom || salleId;

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

/**
 * Récupère et affiche le score prédit pour la salle courante.
 * Essaie d'abord /api/predict/score, puis /api/predict/preventive-actions en fallback.
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

    const enseigne = config?.lieux?.enseignes?.find((e) => e.id === enseigneId);
    const salle = enseigne?.pieces?.find((p) => p.id === salleId);

    if (!enseigne || !salle) {
      console.warn(
        `[dashboard] Could not find enseigne/salle for ${enseigneId}/${salleId}`,
      );
      return;
    }

    const enseigneNom = enseigne.nom;
    const salleNom = salle.nom;
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
      console.log(`[dashboard] Trying predictScore: ${scoreUrl}`);
      const resp = await fetch(scoreUrl, { headers });
      if (resp.ok) {
        const data = await resp.json();
        if (typeof data.predicted_score === "number") {
          predictedScore = data.predicted_score;
          trendValue = data.trend || data.predicted_level || "";
          console.log(
            `[dashboard] Got predicted score from /predict/score: ${predictedScore}`,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[dashboard] /predict/score failed, trying fallback...",
        e.message,
      );
    }

    // --- Tentative 2 : /api/predict/preventive-actions (fallback) ---
    if (predictedScore === null) {
      try {
        const params = new URLSearchParams({
          enseigne: enseigneNom,
          salle: salleNom,
        });
        const url = `${API_ENDPOINTS.preventiveActions}?${params}`;
        console.log(`[dashboard] Trying preventiveActions fallback: ${url}`);
        const response = await fetchWithRetry(url, {}, 1);
        if (response.ok) {
          const data = await response.json();
          const ps =
            data.status && data.status.predicted_score !== undefined
              ? data.status.predicted_score
              : data.predicted_score;
          if (ps !== undefined && ps !== null) {
            predictedScore = ps;
            console.log(
              `[dashboard] Got predicted score from /preventive-actions: ${predictedScore}`,
            );
          }
        }
      } catch (e2) {
        console.warn(
          "[dashboard] /preventive-actions fallback also failed:",
          e2.message,
        );
      }
    }

    // --- Affichage ---
    if (predictedScore !== null) {
      const roundedScore = Math.round(predictedScore);
      scoreElement.textContent = roundedScore;

      scoreElement.style.color =
        roundedScore >= 81
          ? "#3aaa8a"
          : roundedScore >= 61
            ? "#6dbf47"
            : roundedScore >= 41
              ? "#f5b731"
              : roundedScore >= 21
                ? "#e87d2f"
                : "#e05252";

      if (trendElement) {
        trendElement.textContent = trendValue;
      }
    } else {
      scoreElement.textContent = "—";
      scoreElement.style.color = "";
    }
  } catch (error) {
    console.error("[dashboard] Error fetching predicted score:", error);
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
