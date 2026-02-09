/*
 * Metric cards and score history sparkline for IAQ dashboard
 */

const API_URL_DATA = (window.API_ENDPOINTS && window.API_ENDPOINTS.measurements)
  ? window.API_ENDPOINTS.measurements
  : "/api/iaq/data";

const REFRESH_MS = 30000;
const SPARKLINE_MINUTES = 60;

const METRICS = [
  { id: "co2", containerId: "co2-chart", label: "CO₂", unit: "ppm", key: "co2", threshold: 1000, decimals: 0 },
  { id: "pm25", containerId: "pm25-chart", label: "PM2.5", unit: "µg/m³", key: "pm25", threshold: 15, decimals: 0 },
  {
    id: "comfort",
    containerId: "comfort-chart",
    label: "Température & Humidité",
    unit: "°C & %",
    key: "temperature",
    threshold: 26,
    decimals: 1,
    secondary: { label: "Humidité", unit: "%", key: "humidity", threshold: 60, decimals: 0 }
  },
  { id: "tvoc", containerId: "tvoc-chart", label: "TVOC", unit: "mg/m³", key: "tvoc", threshold: 1000, decimals: 0 }
];

const STATUS_COLORS = {
  ok: { line: "#22c55e", fill: "rgba(34,197,94,0.2)" },
  alert: { line: "#ef4444", fill: "rgba(239,68,68,0.2)" }
};

let charts = {
  metrics: {},
  scoreHistory: null
};

let httpPollingInterval = null;

function getActiveContext() {
  const cfg = (typeof window.getConfig === "function") ? window.getConfig() : (window.config || null);
  const activeEnseigneId = (typeof window.getActiveEnseigne === "function")
    ? window.getActiveEnseigne()
    : (cfg && cfg.lieux && cfg.lieux.active);

  let enseigne = null;
  let salle = null;

  if (cfg && cfg.lieux && cfg.lieux.enseignes) {
    const ens = cfg.lieux.enseignes.find(e => e.id === activeEnseigneId) || cfg.lieux.enseignes[0];
    enseigne = ens ? (ens.nom || ens.id) : null;
    const piece = ens && ens.pieces && ens.pieces.length > 0 ? ens.pieces[0] : null;
    salle = piece ? (piece.nom || piece.id) : null;
  }

  if (window.currentEnseigne) enseigne = window.currentEnseigne;
  if (window.currentSalle) salle = window.currentSalle;

  return { enseigne, salle };
}

async function ensureConfigLoaded() {
  if (typeof window.loadConfig === "function" && !window.getConfig?.()) {
    try { await window.loadConfig(); } catch (e) {}
  }
  const cfg = (typeof window.getConfig === "function") ? window.getConfig() : (window.config || null);
  if (cfg && cfg.lieux && cfg.lieux.enseignes && cfg.lieux.enseignes.length > 0) {
    const ens = cfg.lieux.enseignes[0];
    const piece = ens.pieces && ens.pieces.length > 0 ? ens.pieces[0] : null;
    if (!window.currentEnseigne) window.currentEnseigne = ens.nom || ens.id;
    if (piece && !window.currentSalle) window.currentSalle = piece.nom || piece.id;
  }
}

function formatLabel(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatValue(value, decimals) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(decimals);
}

function getRecentSlice(data, minutes) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const last = data[data.length - 1];
  const lastTs = new Date(last._time || last.time || last.timestamp).getTime();
  if (Number.isNaN(lastTs)) return data.slice(-12);
  const cutoff = lastTs - minutes * 60 * 1000;
  const filtered = data.filter(item => {
    const t = new Date(item._time || item.time || item.timestamp).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
  return filtered.length > 0 ? filtered : data.slice(-12);
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
  const sparkline = metric.secondary
    ? `
      <div class="metric-sparkline metric-sparkline-grid">
        <div class="metric-mini">
          <span class="metric-mini-label" id="${metric.id}-primary-label">
            <span class="metric-mini-dot"></span>${metric.label}
          </span>
          <canvas id="${metric.id}-canvas"></canvas>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-label" id="${metric.id}-secondary-label">
            <span class="metric-mini-dot"></span>${metric.secondary.label}
          </span>
          <canvas id="${metric.id}-secondary-canvas"></canvas>
        </div>
      </div>
    `
    : `
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
    <div class="metric-subtitle">Dernières 60 minutes</div>
    ${sparkline}
  `;
  return {
    primary: container.querySelector(`#${metric.id}-canvas`),
    secondary: container.querySelector(`#${metric.id}-secondary-canvas`)
  };
}

function createSparklineChart(canvas, datasetCount) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const datasets = Array.from({ length: datasetCount }, () => ({
    data: [],
    borderColor: STATUS_COLORS.ok.line,
    backgroundColor: STATUS_COLORS.ok.fill,
    tension: 0.35,
    pointRadius: 0,
    borderWidth: 2,
    fill: true
  }));

  return new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
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
      datasets: [{
        data: [],
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.15)",
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } }
    }
  });
}

function initCharts() {
  if (typeof Chart === "undefined") {
    console.error("[charts] Chart.js not loaded");
    return;
  }

  destroyCharts();

  METRICS.forEach(metric => {
    const canvases = buildMetricCard(metric);
    const primaryChart = createSparklineChart(canvases?.primary, 1);
    const secondaryChart = metric.secondary
      ? createSparklineChart(canvases?.secondary, 1)
      : null;
    if (primaryChart) {
      if (secondaryChart) {
        secondaryChart.data.datasets[0].fill = false;
        secondaryChart.data.datasets[0].backgroundColor = "rgba(0,0,0,0)";
        secondaryChart.data.datasets[0].borderWidth = 2;
      }
      charts.metrics[metric.id] = { primary: primaryChart, secondary: secondaryChart };
    }
  });

  charts.scoreHistory = createScoreHistoryChart();
}

function destroyCharts() {
  Object.keys(charts.metrics).forEach(key => {
    const chartEntry = charts.metrics[key];
    if (chartEntry?.primary) chartEntry.primary.destroy();
    if (chartEntry?.secondary) chartEntry.secondary.destroy();
  });
  charts.metrics = {};

  if (charts.scoreHistory) {
    charts.scoreHistory.destroy();
    charts.scoreHistory = null;
  }
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

  const cardState = (primary === "alert" || secondary === "alert") ? "alert" : "ok";
  container.classList.remove("metric-ok", "metric-alert");
  container.classList.add(cardState === "alert" ? "metric-alert" : "metric-ok");
  return { primary, secondary };
}

function updateChartsWithData(data) {
  if (!Array.isArray(data)) return;
  if (!charts.scoreHistory || Object.keys(charts.metrics).length === 0) initCharts();

  const recent = getRecentSlice(data, SPARKLINE_MINUTES);
  const labels = recent.map(d => formatLabel(d._time || d.time || d.timestamp));

  METRICS.forEach(metric => {
    const series = recent.map(d => d[metric.key] ?? null);
    const value = [...series].reverse().find(v => typeof v === "number");
    const valueEl = document.getElementById(`${metric.id}-value`);
    if (valueEl) valueEl.textContent = formatValue(value, metric.decimals);

    let secondarySeries = [];
    let secondaryValue = null;
    if (metric.secondary) {
      const rawSecondary = recent.map(d => d[metric.secondary.key] ?? null);
      secondarySeries = rawSecondary;
      secondaryValue = [...rawSecondary].reverse().find(v => typeof v === "number");
      const secondaryBigEl = document.getElementById(`${metric.id}-secondary-big`);
      if (secondaryBigEl) {
        secondaryBigEl.textContent = `${formatValue(secondaryValue, metric.secondary.decimals)} ${metric.secondary.unit}`;
      }
    }

    const status = applyMetricState(metric, value, secondaryValue);
    const chartEntry = charts.metrics[metric.id];
    if (chartEntry?.primary) {
      chartEntry.primary.data.labels = labels;
      chartEntry.primary.data.datasets[0].data = series;
      chartEntry.primary.data.datasets[0].borderColor = STATUS_COLORS[status.primary].line;
      chartEntry.primary.data.datasets[0].backgroundColor = STATUS_COLORS[status.primary].fill;
      chartEntry.primary.update("none");
    }

    if (metric.secondary && chartEntry?.secondary) {
      chartEntry.secondary.data.labels = labels;
      chartEntry.secondary.data.datasets[0].data = secondarySeries;
      chartEntry.secondary.data.datasets[0].borderColor = STATUS_COLORS[status.secondary].line;
      chartEntry.secondary.data.datasets[0].backgroundColor = "rgba(0,0,0,0)";
      chartEntry.secondary.update("none");
    }

    if (metric.secondary) {
      const primaryLabel = document.getElementById(`${metric.id}-primary-label`);
      const secondaryLabel = document.getElementById(`${metric.id}-secondary-label`);
      if (primaryLabel) {
        primaryLabel.classList.remove("metric-ok", "metric-alert");
        primaryLabel.classList.add(status.primary === "alert" ? "metric-alert" : "metric-ok");
      }
      if (secondaryLabel) {
        secondaryLabel.classList.remove("metric-ok", "metric-alert");
        secondaryLabel.classList.add(status.secondary === "alert" ? "metric-alert" : "metric-ok");
      }
    }
  });

  const scoreSeries = recent.map(d => d.global_score ?? d.score ?? null);
  if (charts.scoreHistory) {
    charts.scoreHistory.data.labels = labels;
    charts.scoreHistory.data.datasets[0].data = scoreSeries;
    charts.scoreHistory.update("none");
  }

  const last = data[data.length - 1];
  if (last && typeof window.setRoomScore === "function") {
    const score = last.global_score ?? last.score;
    window.setRoomScore(typeof score === "number" ? score : null, { note: "" });
  }
}

async function fetchPredictedScore(enseigne, salle) {
  try {
    const headers = {};
    if (typeof getAuthToken === 'function') {
      const token = await getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `/api/predict/score?enseigne=${encodeURIComponent(enseigne)}&salle=${encodeURIComponent(salle)}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return;
    const data = await resp.json();

    const el = document.getElementById('predicted-score-value');
    const trend = document.getElementById('predicted-score-trend');
    if (el) el.textContent = (typeof data.score === 'number') ? Math.round(data.score) : '—';
    if (trend) trend.textContent = data.trend || '';
  } catch (e) {
    console.warn('[charts] predicted score error', e);
  }
}

async function fetchAndUpdate() {
  try {
    await ensureConfigLoaded();
    const { enseigne, salle } = getActiveContext();
    const headers = { 'ngrok-skip-browser-warning': 'true' };
    if (typeof getAuthToken === 'function') {
      const token = await getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const params = new URLSearchParams();
    if (enseigne) params.set('enseigne', enseigne);
    if (salle) params.set('salle', salle);
    params.set('hours', '24');
    params.set('step', '5min');
    const url = `${API_URL_DATA}?${params.toString()}`;
    let resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      // Fallback: try without aggregation if empty
      const fallbackParams = new URLSearchParams();
      if (enseigne) fallbackParams.set('enseigne', enseigne);
      if (salle) fallbackParams.set('salle', salle);
      fallbackParams.set('hours', '24');
      resp = await fetch(`${API_URL_DATA}?${fallbackParams.toString()}`, { headers });
      if (resp.ok) data = await resp.json();
    }
    updateChartsWithData(Array.isArray(data) ? data : []);
    if (enseigne && salle) fetchPredictedScore(enseigne, salle);
  } catch (e) {
    console.error('[charts] fetch error', e);
  }
}

function resetCharts() {
  destroyCharts();
  initCharts();
}

function startPolling() {
  if (httpPollingInterval) clearInterval(httpPollingInterval);
  httpPollingInterval = setInterval(fetchAndUpdate, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  fetchAndUpdate();
  startPolling();
});

window.addEventListener('load', () => {
  resetCharts();
  fetchAndUpdate();
});

// Refresh charts on room changes (tabs manager)
document.addEventListener('roomChanged', () => {
  fetchAndUpdate();
});

window.resetCharts = resetCharts;
window.fetchAndUpdate = fetchAndUpdate;
