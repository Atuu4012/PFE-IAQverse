/*
 * Metric cards and score history sparkline for IAQ dashboard
 */

const API_URL_DATA =
  window.API_ENDPOINTS && window.API_ENDPOINTS.measurements
    ? window.API_ENDPOINTS.measurements
    : "/api/iaq/data";

const REFRESH_MS = 30000;
const SPARKLINE_POINTS = 60;

const METRICS = [
  {
    id: "co2",
    containerId: "co2-chart",
    label: "CO₂",
    unit: "ppm",
    key: "co2",
    threshold: 1000,
    decimals: 0,
  },
  {
    id: "pm25",
    containerId: "pm25-chart",
    label: "PM2.5",
    unit: "µg/m³",
    key: "pm25",
    threshold: 15,
    decimals: 0,
  },
  {
    id: "comfort",
    containerId: "comfort-chart",
    label: "Température & Humidité",
    unit: "°C & %",
    key: "temperature",
    threshold: 26,
    decimals: 1,
    secondary: {
      label: "Humidité",
      unit: "%",
      key: "humidity",
      threshold: 60,
      decimals: 0,
    },
  },
  {
    id: "tvoc",
    containerId: "tvoc-chart",
    label: "TVOC",
    unit: "mg/m³",
    key: "tvoc",
    threshold: 1000,
    decimals: 0,
  },
];

const STATUS_COLORS = {
  ok: { line: "#22c55e", fill: "rgba(34,197,94,0.2)" },
  alert: { line: "#ef4444", fill: "rgba(239,68,68,0.2)" },
};

let charts = {
  metrics: {},
  scoreHistory: null,
};

let httpPollingInterval = null;
let measurementTickCount = 0;

function getActiveContext() {
  const cfg =
    typeof window.getConfig === "function"
      ? window.getConfig()
      : window.config || null;
  const activeEnseigneId =
    typeof window.getActiveEnseigne === "function"
      ? window.getActiveEnseigne()
      : cfg && cfg.lieux && cfg.lieux.active;

  let enseigne = null;
  let salle = null;

  if (cfg && cfg.lieux && cfg.lieux.enseignes) {
    const ens =
      cfg.lieux.enseignes.find((e) => e.id === activeEnseigneId) ||
      cfg.lieux.enseignes[0];
    enseigne = ens ? ens.nom || ens.id : null;
    const piece =
      ens && ens.pieces && ens.pieces.length > 0 ? ens.pieces[0] : null;
    salle = piece ? piece.nom || piece.id : null;
  }

  if (window.currentEnseigne) enseigne = window.currentEnseigne;
  if (window.currentSalle) salle = window.currentSalle;

  return { enseigne, salle };
}

async function ensureConfigLoaded() {
  if (typeof window.loadConfig === "function" && !window.getConfig?.()) {
    try {
      await window.loadConfig();
    } catch (e) {}
  }
  const cfg =
    typeof window.getConfig === "function"
      ? window.getConfig()
      : window.config || null;
  if (
    cfg &&
    cfg.lieux &&
    cfg.lieux.enseignes &&
    cfg.lieux.enseignes.length > 0
  ) {
    const ens = cfg.lieux.enseignes[0];
    const piece = ens.pieces && ens.pieces.length > 0 ? ens.pieces[0] : null;
    if (!window.currentEnseigne) window.currentEnseigne = ens.nom || ens.id;
    if (piece && !window.currentSalle)
      window.currentSalle = piece.nom || piece.id;
  }
}

function formatLabel(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatValue(value, decimals) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(decimals);
}

function getRecentSlice(data, count) {
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.slice(-count);
}

function buildMetricCard(metric) {
  const container = document.getElementById(metric.containerId);
  if (!container) return null;
  const valuesRow = metric.secondary
    ? `
      <div class="metric-values-row">
        <div class="metric-value" id="${metric.id}-value">—</div>
        <div class="metric-value-secondary-big" id="${metric.id}-secondary-big">—</div>
      </div>
    `
    : `<div class="metric-value" id="${metric.id}-value">—</div>`;

  // Always use a single canvas for the chart, even if secondary exists (dual axis)
  const sparkline = `
      <div class="metric-sparkline">
        <canvas id="${metric.id}-canvas"></canvas>
      </div>
    `;

  container.innerHTML = `
    <div class="metric-header">
      <div class="metric-title">${metric.label}</div>
      <div class="metric-unit">${metric.unit}</div>
    </div>
    ${valuesRow}
    <div class="metric-subtitle">60 dernières mesures</div>
    ${sparkline}
  `;
  return {
    primary: container.querySelector(`#${metric.id}-canvas`),
    secondary: null, // No separate canvas for secondary
  };
}

function createSparklineChart(canvas, metric) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const secondaryConfig = metric.secondary || null;

  const datasets = [];

  // Dataset 0 (Primary)
  datasets.push({
    data: [],
    borderColor: STATUS_COLORS.ok.line,
    backgroundColor: "transparent",
    tension: 0.35,
    pointRadius: 0,
    borderWidth: 2,
    fill: false,
    yAxisID: "y",
  });

  // Dataset 1 (Secondary if exists)
  if (secondaryConfig) {
    datasets.push({
      data: [],
      borderColor: "#9ca3af", // Permanent gray for secondary
      backgroundColor: "rgba(0,0,0,0)",
      tension: 0.35,
      pointRadius: 0,
      borderWidth: 2,
      fill: false,
      yAxisID: "y1",
    });
  }

  const scales = {
    x: {
      display: true,
      grid: {
        color: (context) =>
          document.documentElement.getAttribute("data-theme") === "sombre"
            ? "rgba(255,255,255,0.05)"
            : "rgba(0,0,0,0.03)",
        drawBorder: false,
        tickLength: 4,
      },
      ticks: {
        font: { size: 10 },
        color: "#9ca3af",
        maxTicksLimit: 6,
        maxRotation: 0,
      },
      border: { display: false },
    },
    y: {
      display: true,
      grid: {
        color: (context) =>
          document.documentElement.getAttribute("data-theme") === "sombre"
            ? "rgba(255,255,255,0.05)"
            : "rgba(0,0,0,0.03)",
        drawBorder: false,
      },
      ticks: {
        font: { size: 10 },
        color: "#9ca3af",
        maxTicksLimit: 4,
      },
      border: { display: false },
    },
  };

  if (secondaryConfig) {
    scales.y1 = {
      display: true,
      position: "right",
      grid: { display: false }, // Only show grid for primary axis
      ticks: {
        font: { size: 10 },
        color: "#9ca3af",
        maxTicksLimit: 4,
        callback: function (value) {
          return value + (secondaryConfig.unit === "%" ? "%" : "");
        },
      },
      border: { display: false },
    };
  }

  return new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, mode: "index", intersect: false },
      },
      scales: scales,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      onHover: (e, elements, chart) => {
        if (elements && elements.length > 0) {
          const index = elements[0].index;
          const val = chart.data.datasets[0].data[index];
          const valueEl = document.getElementById(`${metric.id}-value`);
          if (valueEl) valueEl.textContent = formatValue(val, metric.decimals);

          if (secondaryConfig && chart.data.datasets.length > 1) {
            const val2 = chart.data.datasets[1].data[index];
            const secondaryBigEl = document.getElementById(
              `${metric.id}-secondary-big`,
            );
            if (secondaryBigEl) {
              secondaryBigEl.textContent = `${formatValue(val2, secondaryConfig.decimals)} ${secondaryConfig.unit}`;
            }
          }
        } else {
          // Reset to last value on hover out (or when no point is selected)
          const lastIndex = chart.data.datasets[0].data.length - 1;
          if (lastIndex >= 0) {
            const val = chart.data.datasets[0].data[lastIndex];
            const valueEl = document.getElementById(`${metric.id}-value`);
            if (valueEl)
              valueEl.textContent = formatValue(val, metric.decimals);

            if (secondaryConfig && chart.data.datasets.length > 1) {
              const val2 = chart.data.datasets[1].data[lastIndex];
              const secondaryBigEl = document.getElementById(
                `${metric.id}-secondary-big`,
              );
              if (secondaryBigEl) {
                secondaryBigEl.textContent = `${formatValue(val2, secondaryConfig.decimals)} ${secondaryConfig.unit}`;
              }
            }
          }
        }
      },
    },
  });
}

function createScoreHistoryChart() {
  const canvas = document.getElementById("score-history-canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          data: [],
          borderColor: "#3b82f6",
          backgroundColor: "transparent",
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: {
          display: true, // Enable Y axis
          min: 0,
          max: 100,
          grid: {
            color: (context) =>
              document.documentElement.getAttribute("data-theme") === "sombre"
                ? "rgba(255,255,255,0.05)"
                : "rgba(0,0,0,0.03)",
            drawBorder: false,
          },
          ticks: {
            font: { size: 9 },
            color: "#9ca3af",
            stepSize: 25,
          },
          border: { display: false },
        },
      },
    },
  });
}

function initCharts() {
  if (typeof Chart === "undefined") {
    console.error("[charts] Chart.js not loaded");
    return;
  }

  destroyCharts();

  METRICS.forEach((metric) => {
    const canvases = buildMetricCard(metric);
    // Create single chart, pass secondary config if it exists
    const chart = createSparklineChart(canvases?.primary, metric);

    if (chart) {
      charts.metrics[metric.id] = { primary: chart, secondary: null };
    }
  });

  charts.scoreHistory = createScoreHistoryChart();
}

function destroyCharts() {
  Object.keys(charts.metrics).forEach((key) => {
    const chartEntry = charts.metrics[key];
    if (chartEntry?.primary) chartEntry.primary.destroy();
    // Secondary is now part of primary chart, so no need to destroy separately
  });
  charts.metrics = {};

  if (charts.scoreHistory) {
    charts.scoreHistory.destroy();
    charts.scoreHistory = null;
  }
}

function resetCharts() {
  destroyCharts();
  initCharts();
  measurementTickCount = 0;
}

function resolveStatus(value, threshold) {
  if (typeof value !== "number" || Number.isNaN(value)) return "ok";
  return value >= threshold ? "alert" : "ok";
}

function applyMetricState(metric, value, secondaryValue) {
  const container = document.getElementById(metric.containerId);
  if (!container) return { primary: "ok", secondary: "ok" };
  const primary = resolveStatus(value, metric.threshold);
  const secondary = metric.secondary
    ? resolveStatus(secondaryValue, metric.secondary.threshold)
    : "ok";

  const cardState =
    primary === "alert" || secondary === "alert" ? "alert" : "ok";
  container.classList.remove("metric-ok", "metric-alert");
  container.classList.add(cardState === "alert" ? "metric-alert" : "metric-ok");
  return { primary, secondary };
}

function updateChartsWithData(data) {
  if (!Array.isArray(data)) return;
  if (!charts.scoreHistory || Object.keys(charts.metrics).length === 0)
    initCharts();

  let recent = getRecentSlice(data, SPARKLINE_POINTS);
  let labels = recent.map((d) =>
    formatLabel(d._time || d.time || d.timestamp),
  );
  // Compléter à gauche si moins de 60 points
  if (labels.length < SPARKLINE_POINTS) {
    const missing = SPARKLINE_POINTS - labels.length;
    labels = Array(missing).fill("").concat(labels);
    // Compléter recent avec des objets vides pour garder l'alignement
    recent = Array(missing).fill({}).concat(recent);
  }

  METRICS.forEach((metric) => {
    const series = recent.map((d) => d[metric.key] ?? null);
    // Compléter à gauche si moins de 60 points
    // (déjà fait via recent, donc series.length == SPARKLINE_POINTS)
    const value = [...series].reverse().find((v) => typeof v === "number");
    const valueEl = document.getElementById(`${metric.id}-value`);
    if (valueEl) valueEl.textContent = formatValue(value, metric.decimals);

    let secondarySeries = [];
    let secondaryValue = null;
    if (metric.secondary) {
      const rawSecondary = recent.map((d) => d[metric.secondary.key] ?? null);
      secondarySeries = rawSecondary;
      secondaryValue = [...rawSecondary]
        .reverse()
        .find((v) => typeof v === "number");
      const secondaryBigEl = document.getElementById(
        `${metric.id}-secondary-big`,
      );
      if (secondaryBigEl) {
        secondaryBigEl.textContent = `${formatValue(secondaryValue, metric.secondary.decimals)} ${metric.secondary.unit}`;
      }
    }

    const status = applyMetricState(metric, value, secondaryValue);
    const chartEntry = charts.metrics[metric.id];

    // Update Primary Dataset (Index 0)
    if (chartEntry?.primary) {
      chartEntry.primary.data.labels = labels;

      const ds0 = chartEntry.primary.data.datasets[0];
      ds0.data = series;
      ds0.borderColor = STATUS_COLORS[status.primary].line;
      ds0.backgroundColor = STATUS_COLORS[status.primary].fill;

      // Update Secondary Dataset (Index 1) if chart has secondary
      if (metric.secondary && chartEntry.primary.data.datasets.length > 1) {
        const ds1 = chartEntry.primary.data.datasets[1];
        ds1.data = secondarySeries;
        // Use a distinct color for humidity/secondary (e.g., blue or purple) or status color
        // Using status color for consistency with alert logic, but ensuring it's distinct if ok
        ds1.borderColor = "#9ca3af";

        ds1.backgroundColor = "rgba(0,0,0,0)";
      }

      chartEntry.primary.update("none");
      // Forcer le resize pour occuper toute la place
      if (typeof chartEntry.primary.resize === "function") {
        chartEntry.primary.resize();
      }
    }
  });

  const scoreSeries = recent.map((d) => d.global_score ?? d.score ?? null);
  if (charts.scoreHistory) {
    charts.scoreHistory.data.labels = labels;
    charts.scoreHistory.data.datasets[0].data = scoreSeries;
    charts.scoreHistory.update("none");
    if (typeof charts.scoreHistory.resize === "function") {
      charts.scoreHistory.resize();
    }
  }

  const last = data[data.length - 1];
  if (last && typeof window.setRoomScore === "function") {
    const score = last.global_score ?? last.score;
    window.setRoomScore(typeof score === "number" ? score : null, { note: "" });
  }

  if (last) {
    try {
      document.dispatchEvent(
        new CustomEvent("measurementReceived", { detail: last }),
      );
    } catch (e) {}
  }
}

async function fetchPredictedScore(enseigne, salle) {
  try {
    const headers = {};
    if (typeof getAuthToken === "function") {
      const token = await getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const url = `/api/predict/score?enseigne=${encodeURIComponent(enseigne)}&salle=${encodeURIComponent(salle)}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return;
    const data = await resp.json();

    // Only update the element if we got a valid score — don't overwrite with "—"
    // since dashboard.js may have already set a valid value from another endpoint.
    if (typeof data.predicted_score === "number") {
      const el = document.getElementById("predicted-score-value");
      const trend = document.getElementById("predicted-score-trend");
      if (el) el.textContent = Math.round(data.predicted_score);
      if (trend) trend.textContent = data.trend || data.predicted_level || "";
    }
  } catch (e) {
    console.warn("[charts] predicted score error", e);
  }
}

async function fetchAndUpdate() {
  try {
    await ensureConfigLoaded();
    const { enseigne, salle } = getActiveContext();
    const headers = {};
    if (typeof getAuthToken === "function") {
      const token = await getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const params = new URLSearchParams();
    if (enseigne) params.set("enseigne", enseigne);
    if (salle) params.set("salle", salle);
    params.set("hours", "1");
    const url = `${API_URL_DATA}?${params.toString()}`;
    let resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      // Fallback: try without aggregation if empty
      const fallbackParams = new URLSearchParams();
      if (enseigne) fallbackParams.set("enseigne", enseigne);
      if (salle) fallbackParams.set("salle", salle);
      fallbackParams.set("hours", "24");
      resp = await fetch(`${API_URL_DATA}?${fallbackParams.toString()}`, {
        headers,
      });
      if (resp.ok) data = await resp.json();
    }
    updateChartsWithData(Array.isArray(data) ? data : []);
    // Note: predicted score is fetched by dashboard.js via roomChanged event, not here.
  } catch (e) {
    console.error("[charts] fetch error", e);
  }
}

function setupWebSocket() {
  if (window.wsManager) {
    if (!window.wsManager.isConnectionActive() && window.wsManager.connect) {
      // Ensure connection is active if not already
      window.wsManager.connect();
    }

    // Subscribe to measurements
    window.wsManager.subscribe(["measurements"]);

    // Listen for new measurements
    window.wsManager.on("measurements", (data) => {
      handleRealtimeMeasurement(data);
    });

    console.log("[charts] WebSocket listener setup");
  } else {
    // Retry if wsManager is not yet available
    setTimeout(setupWebSocket, 1000);
  }
}

function handleRealtimeMeasurement(data) {
  if (!data) return;
  const { enseigne, salle } = getActiveContext();

  // Verify context match (if data contains enseigne/salle info)
  // Assuming data structure: { enseigne: "...", salle: "...", ...measurements... }
  // or data structure: { tags: { enseigne: "...", salle: "..." }, fields: { ... } }
  // Adjust based on actual API payload structure.
  // For now, assuming direct match or loose match if context is missing in data.

  // Checking data structure from previous logs/knowledge.
  // Usually data comes as: { time: ..., ...values... }
  // If it's a broadcast, it should have tags.
  // Let's be permissive for now or check if properties exist.

  let dataEnseigne = data.enseigne || (data.tags && data.tags.enseigne);
  let dataSalle =
    data.salle ||
    (data.tags && data.tags.salle) ||
    (data.tags && data.tags.piece);

  // If context is set, strict check. If not, maybe update anyway?
  // Better strict check to avoid cross-room pollution.
  if (enseigne && dataEnseigne && dataEnseigne !== enseigne) return;
  if (salle && dataSalle && dataSalle !== salle) return;

  const timestamp = new Date(
    data._time || data.time || data.timestamp || Date.now(),
  ).getTime();
  const label = formatLabel(timestamp);

  // Update Metrics — always push for ALL charts so they scroll together
  METRICS.forEach((metric) => {
    const chartEntry = charts.metrics[metric.id];
    if (!chartEntry || !chartEntry.primary) return;

    const chart = chartEntry.primary;

    // Read value from WebSocket data (or fallback to last known)
    let val = data[metric.key];
    if (val === undefined && data.fields) val = data.fields[metric.key];

    // Use last known value if this metric is missing from current message
    if (typeof val !== "number") {
      const lastData = chart.data.datasets[0].data;
      val = lastData.length > 0 ? lastData[lastData.length - 1] : null;
    }

    // Update DOM value
    if (typeof val === "number") {
      const valueEl = document.getElementById(`${metric.id}-value`);
      if (valueEl) valueEl.textContent = formatValue(val, metric.decimals);
    }

    // Always push a new point for each WebSocket message
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(val);
    if (chart.data.labels.length > 60) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }

    // Secondary value (e.g. humidity)
    let secVal = null;
    if (metric.secondary) {
      secVal = data[metric.secondary.key];
      if (secVal === undefined && data.fields)
        secVal = data.fields[metric.secondary.key];
      // Fallback to last known
      if (typeof secVal !== "number" && chart.data.datasets.length > 1) {
        const ds1 = chart.data.datasets[1];
        secVal = ds1.data.length > 0 ? ds1.data[ds1.data.length - 1] : null;
      }
    }

    // Update color/status
    const status = applyMetricState(metric, val, secVal);
    chart.data.datasets[0].borderColor = STATUS_COLORS[status.primary].line;
    chart.data.datasets[0].backgroundColor = STATUS_COLORS[status.primary].fill;

    // Secondary Dataset
    if (metric.secondary && chart.data.datasets.length > 1) {
      const ds1 = chart.data.datasets[1];
      ds1.data.push(secVal);
      if (ds1.data.length > 60) ds1.data.shift();

      if (typeof secVal === "number") {
        const secondaryBigEl = document.getElementById(
          `${metric.id}-secondary-big`,
        );
        if (secondaryBigEl) {
          secondaryBigEl.textContent = `${formatValue(secVal, metric.secondary.decimals)} ${metric.secondary.unit}`;
        }
      }
      ds1.borderColor = "#9ca3af";
    }

    chart.update("none");
  });

  // Update Score — also always push
  let score = data.global_score || data.score;
  if (score === undefined && data.fields)
    score = data.fields.global_score || data.fields.score;

  if (charts.scoreHistory) {
    const chart = charts.scoreHistory;
    // Fallback to last known score
    if (typeof score !== "number") {
      const lastData = chart.data.datasets[0].data;
      score = lastData.length > 0 ? lastData[lastData.length - 1] : null;
    }

    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(score);
    if (chart.data.labels.length > 60) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update("none");

    if (
      typeof score === "number" &&
      typeof window.setRoomScore === "function"
    ) {
      window.setRoomScore(score, { note: "" });
    }
  }

  // Polling score predictif toutes les 5 mesures
  measurementTickCount++;
  if (measurementTickCount >= 5) {
    measurementTickCount = 0;
    document.dispatchEvent(new CustomEvent("predictScoreTick"));
  }
}

// Export functions to window
window.resetCharts = resetCharts;
window.fetchAndUpdate = fetchAndUpdate;
// window.startPolling = startPolling; // Deprecated
window.setupWebSocket = setupWebSocket;

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  initCharts();
  setupWebSocket(); // Start real-time updates
  // Note: fetchAndUpdate() is triggered by the initial roomChanged event from tabs-manager
});

// Note: no duplicate 'load' handler — DOMContentLoaded already initializes charts

// Refresh charts on room changes (tabs manager)
// Note: fetchAndUpdate() is called by dashboard.js via updateCharts()
document.addEventListener("roomChanged", () => {
  resetCharts();
});
