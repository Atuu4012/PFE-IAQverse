// Génère les bandes de seuil avec une palette plus visible (info=vert, warning=orange, danger=rouge)
// thresholds: { info, warning, danger, max }
function getThresholdShapes(type, thresholds) {
  const colors = {
    info: "rgba(40,167,69,0.15)", // vert
    warning: "rgba(255,193,7,0.15)", // jaune / orange
    danger: "rgba(220,53,69,0.15)", // rouge
  };
  const shapes = [];
  // On suppose une progression info < warning < danger
  const info = thresholds.info;
  const warn = thresholds.warning;
  const danger = thresholds.danger;
  const max =
    thresholds.max ||
    (danger ? danger * 1.2 : warn ? warn * 1.2 : info ? info * 1.2 : 100); // valeur haute pour fermer la zone danger
  // Info: de 0 à info
  if (typeof info === "number") {
    shapes.push({
      type: "rect",
      xref: "paper",
      yref: "y",
      x0: 0,
      x1: 1,
      y0: 0,
      y1: info,
      fillcolor: colors.info,
      line: { width: 1, color: "rgba(40,167,69,0.7)", dash: "dot" },
    });
  }
  // Warning: de info à danger
  if (typeof warn === "number" && typeof danger === "number") {
    shapes.push({
      type: "rect",
      xref: "paper",
      yref: "y",
      x0: 0,
      x1: 1,
      y0: info ?? warn,
      y1: danger,
      fillcolor: colors.warning,
      line: { width: 1, color: "rgba(255,193,7,0.9)", dash: "dot" },
    });
  }
  // Danger: au-delà de danger
  if (typeof danger === "number") {
    shapes.push({
      type: "rect",
      xref: "paper",
      yref: "y",
      x0: 0,
      x1: 1,
      y0: danger,
      y1: max,
      fillcolor: colors.danger,
      line: { width: 1, color: "rgba(220,53,69,0.9)", dash: "dot" },
    });
  }
  return shapes;
}

// Génère les zones OMS pour température (gauche) et humidité (droite) sur le comfort chart
function getComfortShapes(maxTemp, maxHum) {
  const colors = {
    info: "rgba(40,167,69,0.15)",
    warning: "rgba(255,193,7,0.15)",
    danger: "rgba(220,53,69,0.15)",
  };
  const shapes = [];

  // Valeurs par défaut si non fournies
  const tempMax = typeof maxTemp === "number" ? maxTemp : 35;
  const humMax = typeof maxHum === "number" ? maxHum : 100;
  const tempMin = Math.min(10, tempMax - 25); // zone basse adaptative
  const humMin = Math.min(0, humMax - 100);

  // TEMPÉRATURE (yref='y', moitié gauche du graphe x0:0 -> x1:0.5)
  // Danger: < 16°C
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 0.5,
    y0: tempMin,
    y1: 16,
    fillcolor: colors.danger,
    line: { width: 1, color: "rgba(220,53,69,0.9)", dash: "dot" },
  });
  // Warning: 16-18°C
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 0.5,
    y0: 16,
    y1: 18,
    fillcolor: colors.warning,
    line: { width: 1, color: "rgba(255,193,7,0.9)", dash: "dot" },
  });
  // Info: 18-22°C
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 0.5,
    y0: 18,
    y1: 22,
    fillcolor: colors.info,
    line: { width: 1, color: "rgba(40,167,69,0.7)", dash: "dot" },
  });
  // Warning: 24-28°C (zone neutre 22-24)
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 0.5,
    y0: 24,
    y1: 28,
    fillcolor: colors.warning,
    line: { width: 1, color: "rgba(255,193,7,0.9)", dash: "dot" },
  });
  // Danger: > 28°C
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y",
    x0: 0,
    x1: 0.5,
    y0: 28,
    y1: tempMax,
    fillcolor: colors.danger,
    line: { width: 1, color: "rgba(220,53,69,0.9)", dash: "dot" },
  });

  // HUMIDITÉ (yref='y2', moitié droite du graphe x0:0.5 -> x1:1)
  // Danger: < 20%
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y2",
    x0: 0.5,
    x1: 1,
    y0: humMin,
    y1: 20,
    fillcolor: colors.danger,
    line: { width: 1, color: "rgba(220,53,69,0.9)", dash: "dash" },
  });
  // Warning: 20-30%
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y2",
    x0: 0.5,
    x1: 1,
    y0: 20,
    y1: 30,
    fillcolor: colors.warning,
    line: { width: 1, color: "rgba(255,193,7,0.9)", dash: "dash" },
  });
  // Info: 40-60% (zone neutre 30-40)
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y2",
    x0: 0.5,
    x1: 1,
    y0: 40,
    y1: 60,
    fillcolor: colors.info,
    line: { width: 1, color: "rgba(40,167,69,0.7)", dash: "dash" },
  });
  // Warning: 70-80% (zone neutre 60-70)
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y2",
    x0: 0.5,
    x1: 1,
    y0: 70,
    y1: 80,
    fillcolor: colors.warning,
    line: { width: 1, color: "rgba(255,193,7,0.9)", dash: "dash" },
  });
  // Danger: > 80%
  shapes.push({
    type: "rect",
    xref: "paper",
    yref: "y2",
    x0: 0.5,
    x1: 1,
    y0: 80,
    y1: humMax,
    fillcolor: colors.danger,
    line: { width: 1, color: "rgba(220,53,69,0.9)", dash: "dash" },
  });

  return shapes;
}
// Configuration
const REFRESH_MS = 3000; // 3s (fallback HTTP uniquement)
/* Fichier des graphiques IAQ - mise à jour dynamique sans rechargement de la page */
const API_URL_DATA = "http://localhost:8000/api/iaq/data";
const chartIds = ["co2-chart", "pm25-chart", "comfort-chart", "tvoc-chart"];
// Evite le conflit avec la variable globale "config" utilisée par index.html
const plotlyConfig = { responsive: true, displayModeBar: false };

// Mode WebSocket: si true, utilise WebSocket temps réel au lieu du polling HTTP
const USE_WEBSOCKET = true;
let httpPollingInterval = null;

// Utiliser des variables globales (var) pour partager avec index.html
var currentEnseigne = window.currentEnseigne || "Maison";
var currentSalle = window.currentSalle || "Salon";
let seenTimestamps = new Set(); // pour déduplication et append
// Mémorise le dernier état de sévérité par chart (info | warning | danger)
let chartSeverity =
  typeof window !== "undefined" && window.chartSeverity
    ? window.chartSeverity
    : {};

// Historique des scores pour calcul de moyenne (dernière minute)
// Charger depuis sessionStorage pour persister lors des changements de thème
function loadScoreHistory() {
  try {
    const stored = sessionStorage.getItem("scoreHistory");
    if (stored) {
      const parsed = JSON.parse(stored);
      // Filtrer pour garder seulement les scores de la dernière minute
      const oneMinuteAgo = Date.now() - 60000;
      return parsed.filter((s) => s.timestamp > oneMinuteAgo);
    }
  } catch (e) {
    console.error("Error loading score history:", e);
  }
  return [];
}

function saveScoreHistory(history) {
  try {
    sessionStorage.setItem("scoreHistory", JSON.stringify(history));
  } catch (e) {
    console.error("Error saving score history:", e);
  }
}

// Utiliser window.scoreHistory pour partager entre reloads
if (!window.scoreHistory) {
  window.scoreHistory = loadScoreHistory();
}
let scoreHistory = window.scoreHistory;

function computeSeverity(value, thresholds) {
  if (typeof value !== "number" || isNaN(value)) return null; // ne pas changer l'état si valeur absente
  if (value >= thresholds.danger) return "danger";
  if (value >= thresholds.warning) return "warning";
  if (value >= 0) return "info";
  return null;
}

// Seuils par graphe
function getThresholdsForChart(id) {
  switch (id) {
    case "co2-chart":
      return { info: 800, warning: 1000, danger: 1200, max: 1500 };
    case "pm25-chart":
      return { info: 5, warning: 15, danger: 35, max: 75 };
    case "tvoc-chart":
      return { info: 300, warning: 800, danger: 1000, max: 1500 };
    default:
      return null;
  }
}

// Récupère la borne max de l'axe (y ou y2) actuellement affichée dans la "case" Plotly
function getAxisRangeMax(chartId, axisKey = "y") {
  try {
    const gd = document.getElementById(chartId);
    if (!gd) return undefined;
    const fl = gd._fullLayout || gd.layout;
    const ax =
      axisKey === "y2" ? fl.yaxis2 || fl[axisKey] : fl.yaxis || fl[axisKey];
    if (ax && Array.isArray(ax.range)) return ax.range[1];
  } catch (e) {}
  return undefined;
}

// Recalcule et réapplique les shapes des seuils avec un max aligné sur la case visible
function refreshThresholdBandsForChart(chartId) {
  const th = getThresholdsForChart(chartId);
  if (!th) return;
  const max = getAxisRangeMax(chartId, "y");
  const shapes = getThresholdShapes(
    chartId,
    Object.assign({}, th, { max: typeof max === "number" ? max : th.max })
  );
  try {
    Plotly.relayout(chartId, { shapes });
  } catch (e) {}
}

// Programme une mise à jour des bandes après rendu (pour laisser Plotly calculer l'autorange)
function scheduleThresholdMaxUpdate(chartId) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => refreshThresholdBandsForChart(chartId));
  } else {
    setTimeout(() => refreshThresholdBandsForChart(chartId), 0);
  }
}

// Recalcule et réapplique les zones OMS du comfort chart avec max adaptatifs
function refreshComfortShapes() {
  const maxTemp = getAxisRangeMax("comfort-chart", "y");
  const maxHum = getAxisRangeMax("comfort-chart", "y2");
  const shapes = getComfortShapes(maxTemp, maxHum);
  try {
    Plotly.relayout("comfort-chart", { shapes });
  } catch (e) {}
}

// Programme une mise à jour des zones comfort après rendu
function scheduleComfortShapesUpdate() {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => refreshComfortShapes());
  } else {
    setTimeout(() => refreshComfortShapes(), 0);
  }
}

// Affiche un message si aucune donnée
function renderEmpty(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  const defaultMsg =
    (t && t("charts.no_data")) ||
    (t && t("notifications.load_error")) ||
    "No data available";
  const msg = message || defaultMsg;
  el.innerHTML = `<div style="padding:16px;color:#666">${msg}</div>`;
}

// Mise en page commune des graphiques
function makeCommonLayout(title, yTitle) {
  const isDark =
    document.documentElement.getAttribute("data-theme") === "sombre";
  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  // detect small screens for responsive behaviour (hide date labels)
  const isSmallScreen =
    typeof window !== "undefined" && window.innerWidth <= 820;
  const timeLabel = t("charts.timeX") || "Heure";
  return {
    autosize: true,
    // Increase bottom margin to avoid truncating date labels
    margin: {
      t: 40,
      r: isSmallScreen ? 60 : 100,
      b: isSmallScreen ? 110 : 130,
      l: 50,
    },
    xaxis: {
      title: isSmallScreen ? "" : timeLabel,
      type: "date",
      showticklabels: !isSmallScreen,
      color: isDark ? "#a8b2c1" : "#2c3e50",
      gridcolor: isDark ? "#3a4049" : "#e2e8f0",
    },
    title: { text: title, font: { color: isDark ? "#e4e7eb" : "#2c3e50" } },
    yaxis: {
      title: yTitle,
      color: isDark ? "#a8b2c1" : "#2c3e50",
      gridcolor: isDark ? "#3a4049" : "#e2e8f0",
    },
    font: {
      family: "Segoe UI, sans-serif",
      color: isDark ? "#e4e7eb" : "#2c3e50",
    },
    paper_bgcolor: isDark ? "#252930" : "#ffffff",
    plot_bgcolor: isDark ? "#252930" : "#ffffff",
    shapes: [], // Zones de seuil injectées ensuite
  };
}

// Initialise les graphiques vides
function initEmptyCharts() {
  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  Plotly.newPlot(
    "co2-chart",
    [
      {
        x: [],
        y: [],
        type: "scatter",
        mode: "lines+markers",
        name: t("charts.trace.co2") || "Évolution du CO₂",
      },
    ],
    makeCommonLayout(
      t("dashboard.co2") || "Évolution du CO₂",
      t("charts.co2Y") || "ppm"
    ),
    plotlyConfig
  );
  Plotly.newPlot(
    "pm25-chart",
    [
      {
        x: [],
        y: [],
        type: "bar",
        name: t("charts.trace.pm25") || "PM2.5 (µg/m³)",
      },
    ],
    makeCommonLayout(
      t("dashboard.pm25") || "Concentration de PM2.5",
      t("charts.pm25Y") || "µg/m³"
    ),
    plotlyConfig
  );
  Plotly.newPlot(
    "comfort-chart",
    [
      {
        x: [],
        y: [],
        type: "scatter",
        name: t("charts.trace.temp") || "Température (°C)",
        line: { color: "red" },
      },
      {
        x: [],
        y: [],
        type: "scatter",
        name: t("charts.trace.humidity") || "Humidité (%)",
        yaxis: "y2",
        line: { color: "blue" },
      },
    ],
    (function () {
      const title = t("dashboard.comfort") || "Température & Humidité";
      const yTitle = t("charts.temperatureY") || "Température (°C)";
      const humidityTitle = t("charts.humidityY") || "Humidité (%)";
      const base = makeCommonLayout(title, yTitle);
      // responsive minimum margins
      const isSmallScreen =
        typeof window !== "undefined" && window.innerWidth <= 820;
      const minR = isSmallScreen ? 70 : 140; // increase desktop right margin to avoid truncation
      const minL = isSmallScreen ? 60 : 100;
      const minB = isSmallScreen ? 90 : 120; // reserve space for legend + gap
      // retirer le titre 'Heure' pour libérer de l'espace pour la légende tout en gardant les ticks visibles
      base.xaxis = Object.assign({}, base.xaxis, {
        title: "",
        showticklabels: true,
      });
      // ensure yaxis2 uses same color as primary yaxis for title/ticks
      const y2 = {
        title: humidityTitle,
        overlaying: "y",
        side: "right",
        color: base.yaxis && base.yaxis.color,
      };
      // position legend: bottom; increase the gap from the plot by lowering 'y'
      const legend = isSmallScreen
        ? {
            orientation: "h",
            x: 0.5,
            xanchor: "center",
            y: -0.12,
            yanchor: "bottom",
          } // plus d'espace sous le graphe en mobile
        : {
            orientation: "h",
            x: 0.5,
            xanchor: "center",
            y: -0.18,
            yanchor: "bottom",
          }; // plus d'espace sous le graphe desktop
      return Object.assign(base, {
        margin: { r: minR, l: minL, b: minB },
        yaxis2: y2,
        legend: legend,
      });
    })(),
    plotlyConfig
  );
  Plotly.newPlot(
    "tvoc-chart",
    [
      {
        x: [],
        y: [],
        type: "scatter",
        name: t("charts.trace.tvoc") || "TVOC (mg/m³)",
      },
    ],
    makeCommonLayout(
      t("dashboard.tvoc") || "Concentration de TVOC",
      t("charts.tvocY") || "mg/m³"
    ),
    plotlyConfig
  );
  // replace tvoc initial plot to include markers consistently
  Plotly.react(
    "tvoc-chart",
    [
      {
        x: [],
        y: [],
        type: "scatter",
        mode: "lines+markers",
        marker: { size: 6 },
        name: t("charts.trace.tvoc") || "TVOC (mg/m³)",
      },
    ],
    makeCommonLayout(
      t("dashboard.tvoc") || "Concentration de TVOC",
      t("charts.tvocY") || "mg/m³"
    ),
    plotlyConfig
  );
  // ensure tvoc and comfort initial traces include markers
}

// Réinitialise les graphiques (appelé lors d'un changement d'enseigne/salle)
function resetCharts() {
  chartIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });
  initEmptyCharts();
  seenTimestamps.clear(); // Vider l'historique des timestamps pour ne charger que la nouvelle salle
}

// Transforme les données en traces Plotly
function buildTracesFromData(data) {
  const timestamps = data.map((d) =>
    d.timestamp ? new Date(d.timestamp) : null
  );
  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  return {
    co2: [
      {
        x: timestamps,
        y: data.map((d) => d.co2),
        type: "scatter",
        mode: "lines+markers",
        name: t("charts.trace.co2") || "CO₂ (ppm)",
        line: { color: "green" },
        marker: { size: 6 },
      },
    ],
    pm25: [
      {
        x: timestamps,
        y: data.map((d) => d.pm25),
        type: "bar",
        name: t("charts.trace.pm25") || "PM2.5 (µg/m³)",
        marker: { color: "orange" },
      },
    ],
    comfort: [
      {
        x: timestamps,
        y: data.map((d) => d.temperature),
        type: "scatter",
        mode: "lines+markers",
        name: t("charts.trace.temp") || "Température (°C)",
        line: { color: "red" },
        marker: { size: 6 },
      },
      {
        x: timestamps,
        y: data.map((d) => d.humidity),
        type: "scatter",
        mode: "lines+markers",
        name: t("charts.trace.humidity") || "Humidité (%)",
        line: { color: "blue" },
        marker: { size: 6 },
        yaxis: "y2",
      },
    ],
    tvoc: [
      {
        x: timestamps,
        y: data.map((d) => d.tvoc),
        type: "scatter",
        mode: "lines+markers",
        name: t("charts.trace.tvoc") || "TVOC (mg/m³)",
        line: { color: "purple" },
        marker: { size: 6 },
      },
    ],
  };
}

// Met à jour les graphiques avec les données
function updateChartsWithData(data) {
  if (!Array.isArray(data) || data.length === 0) {
    chartIds.forEach((id) => renderEmpty(id));
    return;
  }
  const traces = buildTracesFromData(data);
  const t =
    window.i18n && typeof window.i18n.t === "function"
      ? window.i18n.t
      : () => undefined;
  // Seuils à adapter selon la logique métier
  // Seuils rétablis avec valeurs distinctes pour une bonne différenciation visuelle
  const co2Thresholds = getThresholdsForChart("co2-chart");
  const pm25Thresholds = getThresholdsForChart("pm25-chart");
  const tvocThresholds = getThresholdsForChart("tvoc-chart");

  // Ajout des shapes de seuils
  let co2Layout = makeCommonLayout(
    t("dashboard.co2") || "Évolution du CO₂",
    t("charts.co2Y") || "ppm"
  );
  let pm25Layout = makeCommonLayout(
    t("dashboard.pm25") || "Concentration de PM2.5",
    t("charts.pm25Y") || "µg/m³"
  );
  let tvocLayout = makeCommonLayout(
    t("dashboard.tvoc") || "Concentration de TVOC",
    t("charts.tvocY") || "mg/m³"
  );

  // Coloration du fond si danger
  const last = data[data.length - 1] || {};
  const co2Box = document.getElementById("co2-chart");
  const pm25Box = document.getElementById("pm25-chart");
  const tvocBox = document.getElementById("tvoc-chart");

  const co2New = computeSeverity(last.co2, co2Thresholds);
  const pm25New = computeSeverity(last.pm25, pm25Thresholds);
  const tvocNew = computeSeverity(last.tvoc, tvocThresholds);

  const co2Eff = (co2New ?? chartSeverity["co2-chart"]) || null;
  const pm25Eff = (pm25New ?? chartSeverity["pm25-chart"]) || null;
  const tvocEff = (tvocNew ?? chartSeverity["tvoc-chart"]) || null;

  if (co2Eff === "danger") {
    co2Layout.plot_bgcolor = "rgba(220,53,69,0.25)";
    co2Box && co2Box.classList.add("chart-danger");
  } else if (co2New) {
    co2Box && co2Box.classList.remove("chart-danger");
  }
  if (pm25Eff === "danger") {
    pm25Box && pm25Box.classList.add("chart-danger");
  } else if (pm25New) {
    pm25Box && pm25Box.classList.remove("chart-danger");
  }
  if (tvocEff === "danger") {
    tvocLayout.plot_bgcolor = "rgba(220,53,69,0.25)";
    tvocBox && tvocBox.classList.add("chart-danger");
  } else if (tvocNew) {
    tvocBox && tvocBox.classList.remove("chart-danger");
  }

  if (co2New) chartSeverity["co2-chart"] = co2New;
  if (pm25New) chartSeverity["pm25-chart"] = pm25New;
  if (tvocNew) chartSeverity["tvoc-chart"] = tvocNew;

  Plotly.react("co2-chart", traces.co2, co2Layout, plotlyConfig);
  Plotly.react("pm25-chart", traces.pm25, pm25Layout, plotlyConfig);

  // Comfort chart avec zones OMS température et humidité
  const baseComfortLayout = makeCommonLayout(
    t("dashboard.comfort") || "Température & Humidité",
    t("charts.temperatureY") || "Température (°C)"
  );
  const isSmallScreen =
    typeof window !== "undefined" && window.innerWidth <= 820;
  const minComfortR = isSmallScreen ? 70 : 140;
  const minComfortB = isSmallScreen ? 90 : 120;
  baseComfortLayout.margin = Object.assign({}, baseComfortLayout.margin, {
    r: Math.max(
      (baseComfortLayout.margin && baseComfortLayout.margin.r) || 50,
      minComfortR
    ),
    b: Math.max(
      (baseComfortLayout.margin && baseComfortLayout.margin.b) || 50,
      minComfortB
    ),
  });
  baseComfortLayout.yaxis2 = Object.assign(
    {},
    {
      title: (t && t("charts.humidityY")) || "Humidité (%)",
      overlaying: "y",
      side: "right",
    },
    { color: baseComfortLayout.yaxis && baseComfortLayout.yaxis.color }
  );
  // retirer le titre 'Heure' pour libérer de l'espace pour la légende tout en gardant les ticks visibles
  baseComfortLayout.xaxis = Object.assign({}, baseComfortLayout.xaxis, {
    title: "",
    showticklabels: true,
  });
  const legend = isSmallScreen
    ? { orientation: "h", x: 0.5, xanchor: "center", y: -0.12, yanchor: "top" }
    : { orientation: "h", x: 0.5, xanchor: "center", y: -0.18, yanchor: "top" }; // plus d'espace sous le graphe desktop

  // Suppression des bandes de zones (OMS) pour un affichage épuré

  // Coloration du fond comfort si danger (température ou humidité)
  const comfortBox = document.getElementById("comfort-chart");
  const tempDanger =
    last.temperature && (last.temperature < 16 || last.temperature > 28);
  const humDanger = last.humidity && (last.humidity < 20 || last.humidity > 80);
  if (tempDanger || humDanger) {
    baseComfortLayout.plot_bgcolor = "rgba(220,53,69,0.25)";
    comfortBox && comfortBox.classList.add("chart-danger");
  } else {
    comfortBox && comfortBox.classList.remove("chart-danger");
  }

  Plotly.react(
    "comfort-chart",
    traces.comfort,
    Object.assign(baseComfortLayout, { legend: legend }),
    plotlyConfig
  );
  Plotly.react("tvoc-chart", traces.tvoc, tvocLayout, plotlyConfig);

  // Calculate and display global IAQ score after initial data load
  if (
    last.co2 != null &&
    last.pm25 != null &&
    last.tvoc != null &&
    last.humidity != null
  ) {
    // Utiliser global_score de l'API backend
    const globalScore =
      typeof last.global_score === "number" ? last.global_score : null;
    if (globalScore !== null && window.setRoomScore) {
      const trend =
        globalScore >= 90 ? "good" : globalScore >= 70 ? "ok" : "bad";
      const trendLabel =
        globalScore >= 90 ? "A" : globalScore >= 70 ? "B" : "C";
      window.setRoomScore(globalScore, { trend, trendLabel, note: "" });

      // Ajouter le score à l'historique avec timestamp
      scoreHistory.push({ score: globalScore, timestamp: Date.now() });
      // Garder seulement les scores de la dernière minute (60 secondes)
      const oneMinuteAgo = Date.now() - 60000;
      scoreHistory = scoreHistory.filter((s) => s.timestamp > oneMinuteAgo);
      // Sauvegarder dans sessionStorage et window
      window.scoreHistory = scoreHistory;
      saveScoreHistory(scoreHistory);
    }
    // Update tab alerts
    if (globalScore !== null && window.updateTabAlerts)
      window.updateTabAlerts(globalScore);
  }
}

// Récupère les données depuis l'API
async function fetchAndUpdate() {
  try {
    if (typeof window === "undefined" || typeof window.fetch !== "function")
      throw new Error("fetch indisponible dans ce contexte");
    const params = new URLSearchParams({
      enseigne: currentEnseigne || "",
      salle: currentSalle || "",
      hours: String(1),
    });
    const url = `${API_URL_DATA}?${params.toString()}`;
    console.debug("IAQ fetch:", url);
    const res = await window.fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      chartIds.forEach((id) => renderEmpty(id));
      return;
    }
    data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const fresh = data.filter(
      (d) => d && d.timestamp && !seenTimestamps.has(d.timestamp)
    );
    if (fresh.length === 0) return;
    fresh.forEach((d) => seenTimestamps.add(d.timestamp));
    const co2El = document.getElementById("co2-chart");
    const hasData =
      co2El &&
      co2El.data &&
      co2El.data[0] &&
      co2El.data[0].x &&
      co2El.data[0].x.length > 0;
    if (!hasData) {
      updateChartsWithData(data);
      return;
    }
    const xs = fresh.map((d) => (d.timestamp ? new Date(d.timestamp) : null));

    // Limiter à 1 heure de données (60 points avec step=1min)
    const maxPoints = 60;
    Plotly.extendTraces(
      "co2-chart",
      { x: [xs], y: [fresh.map((d) => d.co2)] },
      [0],
      maxPoints
    );
    Plotly.extendTraces(
      "pm25-chart",
      { x: [xs], y: [fresh.map((d) => d.pm25)] },
      [0],
      maxPoints
    );
    Plotly.extendTraces(
      "comfort-chart",
      {
        x: [xs, xs],
        y: [fresh.map((d) => d.temperature), fresh.map((d) => d.humidity)],
      },
      [0, 1],
      maxPoints
    );
    Plotly.extendTraces(
      "tvoc-chart",
      { x: [xs], y: [fresh.map((d) => d.tvoc)] },
      [0],
      maxPoints
    );
    // Après extension des traces, mettre à jour la sévérité seulement si nouvelle valeur numérique
    try {
      const co2Box = document.getElementById("co2-chart");
      const pm25Box = document.getElementById("pm25-chart");
      const tvocBox = document.getElementById("tvoc-chart");
      const comfortBox = document.getElementById("comfort-chart");
      const thCo2 = getThresholdsForChart("co2-chart");
      const thPm = getThresholdsForChart("pm25-chart");
      const thTvoc = getThresholdsForChart("tvoc-chart");
      const lastCo2 = co2Box && co2Box.data && co2Box.data[0]?.y?.slice(-1)[0];
      const lastPm =
        pm25Box && pm25Box.data && pm25Box.data[0]?.y?.slice(-1)[0];
      const lastTvoc =
        tvocBox && tvocBox.data && tvocBox.data[0]?.y?.slice(-1)[0];
      const lastHumidity =
        comfortBox && comfortBox.data && comfortBox.data[1]?.y?.slice(-1)[0];
      const sCo2 = computeSeverity(lastCo2, thCo2);
      const sPm = computeSeverity(lastPm, thPm);
      const sTvoc = computeSeverity(lastTvoc, thTvoc);
      if (sCo2) {
        chartSeverity["co2-chart"] = sCo2;
        if (sCo2 === "danger") co2Box.classList.add("chart-danger");
        else co2Box && co2Box.classList.remove("chart-danger");
      }
      if (sPm) {
        chartSeverity["pm25-chart"] = sPm;
        if (sPm === "danger") pm25Box.classList.add("chart-danger");
        else pm25Box && pm25Box.classList.remove("chart-danger");
      }
      if (sTvoc) {
        chartSeverity["tvoc-chart"] = sTvoc;
        if (sTvoc === "danger") tvocBox.classList.add("chart-danger");
        else tvocBox && tvocBox.classList.remove("chart-danger");
      }

      // Calculate and display global IAQ score
      if (
        typeof lastCo2 === "number" &&
        typeof lastPm === "number" &&
        typeof lastTvoc === "number" &&
        typeof lastHumidity === "number"
      ) {
        // Utiliser global_score de l'API backend (dernière valeur de data)
        const lastDataItem = data[data.length - 1];
        const globalScore =
          lastDataItem && typeof lastDataItem.global_score === "number"
            ? lastDataItem.global_score
            : null;
        if (globalScore !== null && window.setRoomScore) {
          const trend =
            globalScore >= 90 ? "good" : globalScore >= 70 ? "ok" : "bad";
          const trendLabel =
            globalScore >= 90 ? "A" : globalScore >= 70 ? "B" : "C";
          window.setRoomScore(globalScore, { trend, trendLabel, note: "" });

          // Ajouter le score à l'historique avec timestamp
          scoreHistory.push({ score: globalScore, timestamp: Date.now() });
          // Garder seulement les scores de la dernière minute (60 secondes)
          const oneMinuteAgo = Date.now() - 60000;
          scoreHistory = scoreHistory.filter((s) => s.timestamp > oneMinuteAgo);
          // Sauvegarder dans sessionStorage et window
          window.scoreHistory = scoreHistory;
          saveScoreHistory(scoreHistory);
        }
        // Update tab alerts
        if (globalScore !== null && window.updateTabAlerts)
          window.updateTabAlerts(globalScore);
      }
    } catch (e) {}
    // plus de bandes adaptatives: conserver uniquement la logique de danger
  } catch (err) {
    console.error("Erreur fetch IAQ :", err);
    chartIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.innerHTML = `<div style="padding:16px;color:#c00">Erreur: ${err.message}</div>`;
    });
  }
}

// Helper function to fetch predicted score from API
async function getPredictedScore(enseigne, salle) {
  try {
    const url = `http://localhost:8000/api/predict/score?enseigne=${encodeURIComponent(
      enseigne
    )}&salle=${encodeURIComponent(salle)}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch prediction: ${response.status}`);
      return null;
    }
    const data = await response.json();

    // Si le modèle n'est pas disponible, retourner null
    if (data.error || data.predicted_score === null) {
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error fetching predicted score:", error);
    return null;
  }
}

// Fetch predicted score from ML model
async function fetchPredictedScore() {
  try {
    const enseigne = currentEnseigne || "Maison";
    const salle = currentSalle || "Salon";
    const data = await getPredictedScore(enseigne, salle);
    updatePredictedScoreUI(data);
  } catch (err) {
    console.error("Erreur fetch ML prediction:", err);
    updatePredictedScoreUI(null);
  }
}

// Update predicted score UI
function updatePredictedScoreUI(data) {
  const valueEl = document.getElementById("predicted-score-value");
  const trendEl = document.getElementById("predicted-score-trend");
  const predictedContainer = document.querySelector(".score-predicted");

  if (!valueEl || !trendEl) return;

  if (!data || data.predicted_score === null) {
    valueEl.textContent = "—";
    trendEl.textContent = "";
    trendEl.className = "predicted-trend";
    if (predictedContainer) {
      predictedContainer.classList.remove(
        "predicted-danger",
        "predicted-warning"
      );
    }
    return;
  }

  const predictedScore = Math.round(data.predicted_score);
  valueEl.textContent = predictedScore;

  // Styliser selon le niveau prédit (A = vert, B = orange, C = rouge)
  if (predictedContainer) {
    predictedContainer.classList.remove(
      "predicted-excellent",
      "predicted-warning",
      "predicted-danger"
    );
    if (predictedScore >= 90) {
      predictedContainer.classList.add("predicted-excellent");
    } else if (predictedScore >= 70) {
      predictedContainer.classList.add("predicted-warning");
    } else {
      predictedContainer.classList.add("predicted-danger");
    }
  }

  // Calculer la moyenne des scores de la dernière minute
  // Toujours utiliser window.scoreHistory pour avoir les données à jour
  const currentHistory = window.scoreHistory || scoreHistory || [];
  let avgScore = null;
  if (currentHistory.length > 0) {
    // Filtrer les scores de la dernière minute
    const oneMinuteAgo = Date.now() - 60000;
    const recentScores = currentHistory.filter(
      (s) => s.timestamp > oneMinuteAgo
    );
    if (recentScores.length > 0) {
      const sum = recentScores.reduce((acc, s) => acc + s.score, 0);
      avgScore = sum / recentScores.length;
    }
  }

  // Comparer la prédiction avec la moyenne récente
  if (avgScore !== null) {
    const diff = predictedScore - avgScore;
    if (diff > 2) {
      trendEl.textContent = "↑";
      trendEl.className = "predicted-trend up";
    } else if (diff < -2) {
      trendEl.textContent = "↓";
      trendEl.className = "predicted-trend down";
    } else {
      trendEl.textContent = "→";
      trendEl.className = "predicted-trend stable";
    }
  } else {
    trendEl.textContent = "";
    trendEl.className = "predicted-trend";
  }
}

/* Initialisation */
if (typeof window !== "undefined" && typeof Plotly !== "undefined") {
  initEmptyCharts();

  // Attendre que tabs-manager ait restauré le contexte avant de charger les données
  let isFirstLoad = true;
  const handleFirstRoomChange = () => {
    if (isFirstLoad) {
      isFirstLoad = false;

      if (USE_WEBSOCKET && window.wsManager) {
        // Mode WebSocket temps réel
        console.log("🔌 Démarrage mode WebSocket temps réel");
        initWebSocketMode();
      } else {
        // Mode polling HTTP classique
        console.log("🔄 Démarrage mode polling HTTP");
        fetchAndUpdate();
        httpPollingInterval = setInterval(fetchAndUpdate, REFRESH_MS);
      }
    }
  };

  // Écouter le premier événement roomChanged pour savoir que le contexte est prêt
  document.addEventListener("roomChanged", handleFirstRoomChange, {
    once: true,
  });

  // Charger la dernière prédiction sauvegardée au démarrage
  try {
    const stored = sessionStorage.getItem("lastPrediction");
    if (stored) {
      const predictionData = JSON.parse(stored);
      // Utiliser la prédiction sauvegardée si elle a moins de 30 secondes
      if (Date.now() - predictionData.fetchedAt < 30000) {
        console.log("Loading cached prediction at startup");
        updatePredictedScoreUI(predictionData);
      }
    }
  } catch (e) {}

  // Fallback: si aucun roomChanged n'est émis après 1 seconde, démarrer quand même
  setTimeout(() => {
    if (isFirstLoad) handleFirstRoomChange();
  }, 1000);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Recompute layouts (hides x-axis on small screens) then resize plots
      try {
        if (typeof refreshChartsTheme === "function") refreshChartsTheme();
      } catch (e) {
        /* ignore */
      }
      chartIds.forEach((id) => {
        const gd = document.getElementById(id);
        if (gd && typeof Plotly.Plots?.resize === "function")
          Plotly.Plots.resize(gd);
      });
    }, 150);
  });

  // ResizeObserver: ensure Plotly resizes when container size changes (useful for responsive layout)
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (el && typeof Plotly.Plots?.resize === "function") {
          Plotly.Plots.resize(el);
        }
      }
      // After batch of resize events, recompute layouts as well
      try {
        if (typeof refreshChartsTheme === "function") refreshChartsTheme();
      } catch (e) {}
    });
    chartIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) ro.observe(el);
    });
  }
} else {
  console.warn("Charts non initialisés : fenêtre ou Plotly introuvable.");
}

/**
 * Initialise le mode WebSocket pour les mises à jour temps réel
 */
function initWebSocketMode() {
  // Charger les données initiales via HTTP
  fetchAndUpdate();

  // Connecter le WebSocket
  if (window.wsManager) {
    window.wsManager.connect();

    // Écouter les nouveaux messages de mesures
    window.wsManager.on("measurements", (data) => {
      console.log("📊 Nouvelles mesures WebSocket:", data);
      handleWebSocketMeasurement(data);
    });

    // Fallback HTTP si WebSocket se déconnecte
    window.wsManager.on("error", () => {
      console.warn("⚠️ WebSocket erreur, fallback sur polling HTTP");
      if (!httpPollingInterval) {
        httpPollingInterval = setInterval(fetchAndUpdate, REFRESH_MS);
      }
    });

    // Écouter la reconnexion pour arrêter le polling HTTP
    window.wsManager.on("connected", () => {
      console.log("✅ WebSocket reconnecté, arrêt du polling HTTP");
      if (httpPollingInterval) {
        clearInterval(httpPollingInterval);
        httpPollingInterval = null;
      }
      // Recharger les données après reconnexion
      fetchAndUpdate();
    });
  }
}

/**
 * Traite un nouveau message de mesure reçu via WebSocket
 */
function handleWebSocketMeasurement(data) {
  // Format du message WebSocket du backend:
  // { topic: 'measurements', data: { timestamp, co2, pm25, temperature, humidity, tvoc, ... } }

  const measurement = data.data || data;

  if (!measurement || !measurement.timestamp) {
    console.warn("Message WebSocket invalide:", data);
    return;
  }

  // Filtrer par enseigne/salle si spécifié
  if (
    currentEnseigne &&
    measurement.enseigne &&
    measurement.enseigne !== currentEnseigne
  ) {
    return;
  }
  if (currentSalle && measurement.salle && measurement.salle !== currentSalle) {
    return;
  }

  // Éviter les doublons
  if (seenTimestamps.has(measurement.timestamp)) {
    return;
  }
  seenTimestamps.add(measurement.timestamp);

  // Ajouter le point aux graphiques
  const timestamp = new Date(measurement.timestamp);
  const maxPoints = 60; // 1 heure de données

  try {
    // Vérifier que les graphiques sont initialisés
    const co2El = document.getElementById("co2-chart");
    if (!co2El || !co2El.data || !co2El.data[0]) {
      // Graphiques pas encore initialisés, charger via HTTP
      fetchAndUpdate();
      return;
    }

    // Étendre les traces avec le nouveau point
    if (typeof measurement.co2 === "number") {
      Plotly.extendTraces(
        "co2-chart",
        { x: [[timestamp]], y: [[measurement.co2]] },
        [0],
        maxPoints
      );
    }
    if (typeof measurement.pm25 === "number") {
      Plotly.extendTraces(
        "pm25-chart",
        { x: [[timestamp]], y: [[measurement.pm25]] },
        [0],
        maxPoints
      );
    }
    if (
      typeof measurement.temperature === "number" &&
      typeof measurement.humidity === "number"
    ) {
      Plotly.extendTraces(
        "comfort-chart",
        {
          x: [[timestamp], [timestamp]],
          y: [[measurement.temperature], [measurement.humidity]],
        },
        [0, 1],
        maxPoints
      );
    }
    if (typeof measurement.tvoc === "number") {
      Plotly.extendTraces(
        "tvoc-chart",
        { x: [[timestamp]], y: [[measurement.tvoc]] },
        [0],
        maxPoints
      );
    }

    // Mettre à jour les sévérités et le score global
    updateChartSeverities(measurement);

    console.debug("✅ Graphiques mis à jour via WebSocket");
  } catch (error) {
    console.error("❌ Erreur mise à jour graphiques WebSocket:", error);
  }
}

/**
 * Met à jour les classes de sévérité des graphiques
 */
function updateChartSeverities(measurement) {
  try {
    const thCo2 = getThresholdsForChart("co2-chart");
    const thPm = getThresholdsForChart("pm25-chart");
    const thTvoc = getThresholdsForChart("tvoc-chart");

    const sCo2 = computeSeverity(measurement.co2, thCo2);
    const sPm = computeSeverity(measurement.pm25, thPm);
    const sTvoc = computeSeverity(measurement.tvoc, thTvoc);

    const co2Box = document.getElementById("co2-chart");
    const pm25Box = document.getElementById("pm25-chart");
    const tvocBox = document.getElementById("tvoc-chart");

    if (sCo2) {
      chartSeverity["co2-chart"] = sCo2;
      if (sCo2 === "danger") co2Box?.classList.add("chart-danger");
      else co2Box?.classList.remove("chart-danger");
    }
    if (sPm) {
      chartSeverity["pm25-chart"] = sPm;
      if (sPm === "danger") pm25Box?.classList.add("chart-danger");
      else pm25Box?.classList.remove("chart-danger");
    }
    if (sTvoc) {
      chartSeverity["tvoc-chart"] = sTvoc;
      if (sTvoc === "danger") tvocBox?.classList.add("chart-danger");
      else tvocBox?.classList.remove("chart-danger");
    }

    // Mettre à jour le score global si disponible
    if (typeof measurement.global_score === "number" && window.setRoomScore) {
      const trend =
        measurement.global_score >= 90
          ? "good"
          : measurement.global_score >= 70
          ? "ok"
          : "bad";
      const trendLabel =
        measurement.global_score >= 90
          ? "A"
          : measurement.global_score >= 70
          ? "B"
          : "C";
      window.setRoomScore(measurement.global_score, {
        trend,
        trendLabel,
        note: "",
      });
    }
  } catch (error) {
    console.error("❌ Erreur updateChartSeverities:", error);
  }
}

// Exposer au global
if (typeof window !== "undefined") {
  window.resetCharts = resetCharts;
  window.fetchAndUpdate = fetchAndUpdate;
  window.currentEnseigne = currentEnseigne;
  window.currentSalle = currentSalle;
  window.refreshChartsTheme = refreshChartsTheme;
  window.initWebSocketMode = initWebSocketMode;
  window.handleWebSocketMeasurement = handleWebSocketMeasurement;
}

// Mise à jour du thème
function refreshChartsTheme() {
  chartIds.forEach((id) => {
    const gd = document.getElementById(id);
    if (gd && gd.data && gd.data.length > 0) {
      // Use i18n translations when available (listen for language changes)
      const t =
        window.i18n && typeof window.i18n.t === "function"
          ? window.i18n.t
          : () => undefined;
      let title = "";
      let yaxisTitle = "";
      switch (id) {
        case "co2-chart":
          title = t("dashboard.co2") || "Évolution du CO₂";
          yaxisTitle = t("charts.co2Y") || "ppm";
          break;
        case "pm25-chart":
          title = t("dashboard.pm25") || "Concentration de PM2.5";
          yaxisTitle = t("charts.pm25Y") || "µg/m³";
          break;
        case "comfort-chart":
          title = t("dashboard.comfort") || "Température & Humidité";
          yaxisTitle = t("charts.temperatureY") || "Température (°C)";
          break;
        case "tvoc-chart":
          title = t("dashboard.tvoc") || "Concentration de TVOC";
          yaxisTitle = t("charts.tvocY") || "mg/m³";
          break;
      }
      const newLayout = makeCommonLayout(title, yaxisTitle);
      // Conserver uniquement la logique de fond rouge si danger (sans bandes de seuil)
      const th = getThresholdsForChart(id);
      if (th) {
        try {
          const lastY = Array.isArray(gd.data[0]?.y)
            ? gd.data[0].y
                .filter((v) => v !== null && v !== undefined)
                .slice(-1)[0]
            : undefined;
          // Ne pas appliquer de fond rouge au graphique PM2.5 (bordure uniquement)
          if (
            id !== "pm25-chart" &&
            typeof lastY === "number" &&
            lastY >= th.danger
          ) {
            newLayout.plot_bgcolor = "rgba(220,53,69,0.15)";
          }
        } catch (e) {}
      }
      if (id === "comfort-chart" && gd.layout.yaxis2) {
        // keep legend settings
        newLayout.legend = gd.layout.legend;
        // Ensure yaxis2 exists and uses same color as primary yaxis
        newLayout.yaxis2 = Object.assign({}, gd.layout.yaxis2, {
          color: newLayout.yaxis && newLayout.yaxis.color,
        });
        // update yaxis2 title from translations when available
        try {
          const t =
            window.i18n && typeof window.i18n.t === "function"
              ? window.i18n.t
              : () => undefined;
          const hy =
            t && typeof t === "function" ? t("charts.humidityY") : undefined;
          if (hy) newLayout.yaxis2.title = hy;
        } catch (e) {}
        // Ensure sufficient right margin so the secondary y-axis (Humidité) fits inside the box
        const existingR =
          (gd.layout && gd.layout.margin && gd.layout.margin.r) ||
          (newLayout.margin && newLayout.margin.r) ||
          50;
        const isSmallScreenR =
          typeof window !== "undefined" && window.innerWidth <= 820;
        const minR = isSmallScreenR ? 60 : 140;
        const minB = isSmallScreenR ? 90 : 120;
        newLayout.margin = Object.assign({}, newLayout.margin, {
          r: Math.max(existingR, minR),
          b: Math.max(
            (gd.layout && gd.layout.margin && gd.layout.margin.b) ||
              (newLayout.margin && newLayout.margin.b) ||
              50,
            minB
          ),
        });
        // Also preserve removal of date tick labels for the comfort chart (responsive/refresh cases)
        // and respect small-screen logic for other charts
        // conserver absence de titre x mais garder les tick labels visibles
        newLayout.xaxis = Object.assign({}, newLayout.xaxis, {
          title: "",
          showticklabels: true,
        });
      }
      Plotly.react(id, gd.data, newLayout, plotlyConfig);
    }
  });
}

// update charts when language changes
if (typeof window !== "undefined") {
  window.addEventListener("language-changed", () => {
    try {
      // update trace names using i18n
      const t =
        window.i18n && typeof window.i18n.t === "function"
          ? window.i18n.t
          : () => undefined;
      chartIds.forEach((id) => {
        const gd = document.getElementById(id);
        if (!gd || !gd.data) return;
        gd.data.forEach((trace, idx) => {
          try {
            switch (id) {
              case "co2-chart":
                trace.name = t("charts.trace.co2") || trace.name;
                break;
              case "pm25-chart":
                trace.name = t("charts.trace.pm25") || trace.name;
                break;
              case "comfort-chart":
                if (idx === 0)
                  trace.name = t("charts.trace.temp") || trace.name;
                if (idx === 1)
                  trace.name = t("charts.trace.humidity") || trace.name;
                break;
              case "tvoc-chart":
                trace.name = t("charts.trace.tvoc") || trace.name;
                break;
            }
          } catch (e) {}
        });
      });
      refreshChartsTheme();
    } catch (e) {}
  });

  // Fonction pour réinitialiser les bordures de danger des graphiques
  window.clearChartDangerBorders = function () {
    const chartIds = ["co2-chart", "pm25-chart", "tvoc-chart", "comfort-chart"];
    chartIds.forEach((id) => {
      const box = document.getElementById(id);
      if (box) {
        box.classList.remove("chart-danger");
      }
    });
    // Réinitialiser aussi les plot_bgcolor
    ["co2-chart", "tvoc-chart"].forEach((id) => {
      const gd = document.getElementById(id);
      if (gd && gd.layout) {
        Plotly.relayout(gd, { plot_bgcolor: "" });
      }
    });
  };

  // Écouter les changements d'onglet pour réinitialiser les bordures
  document.addEventListener("roomChanged", () => {
    try {
      if (typeof window.clearChartDangerBorders === "function") {
        window.clearChartDangerBorders();
      }
    } catch (e) {}
  });

  document.addEventListener("enseigneChanged", () => {
    try {
      if (typeof window.clearChartDangerBorders === "function") {
        window.clearChartDangerBorders();
      }
    } catch (e) {}
  });
}

// ==========================================
// PREDICTED SCORE AUTO-UPDATE (independent of Plotly)
// ==========================================
// Mettre à jour le score prédit régulièrement (toutes les 30 secondes)
// Ce code s'exécute même si Plotly n'est pas chargé
if (typeof window !== "undefined") {
  // Attendre que le DOM soit prêt
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupPredictedScoreInterval);
  } else {
    setupPredictedScoreInterval();
  }

  function setupPredictedScoreInterval() {
    // Appel initial après un court délai
    setTimeout(() => fetchPredictedScore(), 500);

    // Mise à jour toutes les 30 secondes
    setInterval(() => fetchPredictedScore(), 30000);

    // Mise à jour immédiate lors du changement de pièce
    document.addEventListener("roomChanged", () => fetchPredictedScore());
  }
}
