import { useEffect, useState, useCallback, useRef } from 'react'
import { useWebSocketStore } from '../stores/websocketStore'
import { useConfigStore } from '../stores/configStore'
import { apiService, API_ENDPOINTS } from '../services/api'
import Navbar from '../components/common/Navbar'
import { useTranslation } from 'react-i18next'
import './Dashboard.css'

// Score grade helper
function getScoreGrade(score) {
  if (score >= 81) return { letter: 'A', cls: 'a' }
  if (score >= 61) return { letter: 'B', cls: 'b' }
  if (score >= 41) return { letter: 'C', cls: 'c' }
  if (score >= 21) return { letter: 'D', cls: 'd' }
  return { letter: 'E', cls: 'e' }
}

// Metric thresholds
const THRESHOLDS = {
  co2: { ok: 800 },
  pm25: { ok: 12 },
  tvoc: { ok: 300 },
}

export default function Dashboard() {
  const { connect, disconnect, addListener, removeListener } = useWebSocketStore()
  const { config, loadConfig, saveConfig } = useConfigStore()
  const { t } = useTranslation()
  
  const [activeEnseigne, setActiveEnseigne] = useState(null)
  const [activeRoom, setActiveRoom] = useState(null)
  const [measurements, setMeasurements] = useState(null)
  const [predictedScore, setPredictedScore] = useState(null)
  const [loading, setLoading] = useState(true)
  const [roomScores, setRoomScores] = useState({}) // key: "enseigneId:roomId"
  const chartRefs = useRef({})

  const ALERT_THRESHOLD = 81

  // Initialize
  useEffect(() => {
    connect()
    initDashboard()
    return () => disconnect()
  }, [])

  // WebSocket listener for real-time updates
  useEffect(() => {
    const handleMeasurement = (data) => {
      if (!config) return
      const ens = config.lieux?.enseignes?.find(e => e.nom === data.enseigne || e.id === data.enseigne)
      const salle = ens?.pieces?.find(p => p.nom === data.salle || p.id === data.salle)
      if (ens && salle) {
        const key = `${ens.id}:${salle.id}`
        if (data.global_score != null) {
          setRoomScores(prev => ({ ...prev, [key]: data.global_score }))
        }
        // Update current measurements if it's the active room
        if (ens.id === activeEnseigne && salle.id === activeRoom) {
          setMeasurements(data)
        }
      }
    }
    addListener('measurements', handleMeasurement)
    return () => removeListener('measurements', handleMeasurement)
  }, [config, activeEnseigne, activeRoom])

  const initDashboard = async () => {
    try {
      setLoading(true)
      let cfg = config
      if (!cfg) cfg = await loadConfig()
      if (!cfg?.lieux?.enseignes?.length) {
        setLoading(false)
        return
      }

      const defaultEnseigne = cfg.lieux.active || cfg.lieux.enseignes[0].id
      const ens = cfg.lieux.enseignes.find(e => e.id === defaultEnseigne) || cfg.lieux.enseignes[0]
      const defaultRoom = cfg.lieux.activeRoom || ens.pieces?.[0]?.id

      setActiveEnseigne(ens.id)
      if (defaultRoom) {
        setActiveRoom(defaultRoom)
        await fetchRoomData(ens, defaultRoom)
      }
    } catch (err) {
      console.error('[Dashboard] init error:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchRoomData = async (enseigne, roomId) => {
    try {
      const ensObj = typeof enseigne === 'string' 
        ? config?.lieux?.enseignes?.find(e => e.id === enseigne) 
        : enseigne
      const salleObj = ensObj?.pieces?.find(p => p.id === roomId)
      if (!ensObj || !salleObj) return

      const data = await apiService.getMeasurements({
        enseigne: ensObj.nom,
        salle: salleObj.nom
      })
      setMeasurements(data)

      // Fetch predicted score
      try {
        const pred = await apiService.getPreventiveActions({
          enseigne: ensObj.nom,
          salle: salleObj.nom
        })
        const ps = pred?.status?.predicted_score ?? pred?.predicted_score
        setPredictedScore(ps != null ? Math.round(ps) : null)
      } catch { setPredictedScore(null) }
    } catch (err) {
      console.error('[Dashboard] fetch error:', err)
    }
  }

  const switchEnseigne = useCallback((enseigneId) => {
    setActiveEnseigne(enseigneId)
    setActiveRoom(null)
    setMeasurements(null)
    setPredictedScore(null)
    saveConfig({ lieux: { active: enseigneId } })

    const ens = config?.lieux?.enseignes?.find(e => e.id === enseigneId)
    if (ens?.pieces?.length) {
      const firstRoom = ens.pieces[0].id
      setActiveRoom(firstRoom)
      fetchRoomData(ens, firstRoom)
    }
  }, [config])

  const switchRoom = useCallback((roomId) => {
    setActiveRoom(roomId)
    setMeasurements(null)
    setPredictedScore(null)
    saveConfig({ lieux: { activeRoom: roomId } })
    
    const ens = config?.lieux?.enseignes?.find(e => e.id === activeEnseigne)
    if (ens) fetchRoomData(ens, roomId)
  }, [config, activeEnseigne])

  // Derived data
  const enseignes = config?.lieux?.enseignes || []
  const currentEnseigne = enseignes.find(e => e.id === activeEnseigne)
  const rooms = currentEnseigne?.pieces || []

  const score = measurements?.global_score != null ? Math.round(measurements.global_score) : null
  const scoreGrade = score != null ? getScoreGrade(score) : null

  const co2 = measurements?.co2
  const pm25 = measurements?.pm25
  const tvoc = measurements?.tvoc
  const temperature = measurements?.temperature
  const humidity = measurements?.humidity

  const co2Status = co2 != null ? (co2 <= THRESHOLDS.co2.ok ? 'ok' : 'alert') : null
  const pm25Status = pm25 != null ? (pm25 <= THRESHOLDS.pm25.ok ? 'ok' : 'alert') : null
  const tvocStatus = tvoc != null ? (tvoc <= THRESHOLDS.tvoc.ok ? 'ok' : 'alert') : null

  return (
    <div className="page">
      <Navbar />

      {/* Tabs */}
      <div className="espace-tabs"></div>
      <div className="tabs-container">
        {/* Location tabs */}
        <div className="location-tabs">
          {enseignes.map(ens => {
            const hasAlert = rooms.some(p => {
              const key = `${ens.id}:${p.id}`
              return roomScores[key] != null && roomScores[key] < ALERT_THRESHOLD
            })
            return (
              <button
                key={ens.id}
                className={`location-tab ${ens.id === activeEnseigne ? 'active' : ''} ${hasAlert ? 'has-alert' : ''}`}
                onClick={() => switchEnseigne(ens.id)}
              >
                {ens.nom}
              </button>
            )
          })}
        </div>

        {/* Room tabs */}
        <div className="room-tabs">
          {rooms.map(room => {
            const key = `${activeEnseigne}:${room.id}`
            const roomScore = roomScores[key]
            const hasAlert = roomScore != null && roomScore < ALERT_THRESHOLD
            return (
              <button
                key={room.id}
                className={`room-tab ${room.id === activeRoom ? 'active' : ''} ${hasAlert ? 'has-alert' : ''}`}
                onClick={() => switchRoom(room.id)}
              >
                {room.nom}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Content */}
      <main className="grid">
        {loading ? (
          <div className="loading-state" style={{ gridColumn: '1 / -1' }}>
            <div className="spinner"></div>
            <p>{t('dashboard.loading', 'Chargement des données...')}</p>
          </div>
        ) : (
          <>
            {/* Score Panel */}
            <div className="score-panel">
              {/* Legend */}
              <div className="score-legend">
                {['A', 'B', 'C', 'D', 'E'].map((letter, i) => (
                  <div className="legend-item" key={letter}>
                    <span className={`legend-badge badge-${letter.toLowerCase()}`}>{letter}</span>
                    <span className="legend-range">
                      {['81-100', '61-80', '41-60', '21-40', '0-20'][i]}
                    </span>
                  </div>
                ))}
              </div>

              {/* Score center */}
              <div className="score-center">
                <div className="score-value">
                  <span className={scoreGrade ? `text-${scoreGrade.cls}` : ''}>{score ?? '—'}</span>
                  <span className="score-max">/100</span>
                </div>
                <div className="score-label">{t('dashboard.score.roomLabel', 'Score actuel')}</div>
                {scoreGrade && (
                  <div className={`score-trend badge-${scoreGrade.cls}`}>
                    {scoreGrade.letter}
                  </div>
                )}
              </div>

              <div className="divider"></div>

              {/* Predicted score */}
              <div className="score-predicted">
                <div className="predicted-value">
                  <span style={predictedScore != null ? { color: predictedScore >= 80 ? 'var(--success)' : predictedScore >= 60 ? 'var(--warning)' : 'var(--danger)' } : {}}>
                    {predictedScore ?? '—'}
                  </span>
                  <span className="score-max">/100</span>
                </div>
                <div className="predicted-label">
                  {t('dashboard.score.predicted', 'Dans 30 min')}
                </div>
              </div>
            </div>

            {/* Metric Cards */}
            <div className={`chart-box metric-card ${co2Status ? `metric-${co2Status}` : ''}`}>
              <div className="metric-header">
                <span className="metric-title">CO₂</span>
                <span className="metric-unit">ppm</span>
              </div>
              <div className="metric-value">{co2 != null ? Math.round(co2) : '—'}</div>
            </div>

            <div className={`chart-box metric-card ${pm25Status ? `metric-${pm25Status}` : ''}`}>
              <div className="metric-header">
                <span className="metric-title">PM2.5</span>
                <span className="metric-unit">µg/m³</span>
              </div>
              <div className="metric-value">{pm25 != null ? pm25.toFixed(1) : '—'}</div>
            </div>

            <div className="chart-box metric-card">
              <div className="metric-header">
                <span className="metric-title">{t('dashboard.comfort', 'Température & Humidité')}</span>
              </div>
              <div className="metric-values-row">
                <div className="metric-value">{temperature != null ? `${temperature.toFixed(1)}°C` : '—'}</div>
                <div className="metric-value-secondary-big">{humidity != null ? `${humidity.toFixed(0)}%` : '—'}</div>
              </div>
            </div>

            <div className={`chart-box metric-card ${tvocStatus ? `metric-${tvocStatus}` : ''}`}>
              <div className="metric-header">
                <span className="metric-title">TVOC</span>
                <span className="metric-unit">ppb</span>
              </div>
              <div className="metric-value">{tvoc != null ? Math.round(tvoc) : '—'}</div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
