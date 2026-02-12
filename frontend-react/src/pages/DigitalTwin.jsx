import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Environment, useGLTF } from '@react-three/drei'
import { useConfigStore } from '../stores/configStore'
import { apiService, API_ENDPOINTS } from '../services/api'
import Navbar from '../components/common/Navbar'
import './DigitalTwin.css'

/* ── GLB Model Component ── */
function GlbModel({ url }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} />
}

/* ── 3D Viewer ── */
function RoomViewer({ glbUrl }) {
  return (
    <Canvas shadows style={{ width: '100%', height: '100%' }}>
      <Suspense fallback={null}>
        <PerspectiveCamera makeDefault position={[4, 3, 4]} fov={50} />
        <OrbitControls enableDamping dampingFactor={0.05} minDistance={1} maxDistance={20} maxPolarAngle={Math.PI / 2} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
        <Environment preset="apartment" />
        {glbUrl && <GlbModel url={glbUrl} />}
      </Suspense>
    </Canvas>
  )
}

/* ════════════════════════════════════════════════════
   DIGITAL TWIN PAGE
   ════════════════════════════════════════════════════ */
export default function DigitalTwin() {
  const { config, loadConfig, saveConfig } = useConfigStore()
  const roomVisualRef = useRef(null)

  const [activeEnseigne, setActiveEnseigne] = useState(null)
  const [activeRoom, setActiveRoom] = useState(null)
  const [iaqData, setIaqData] = useState(null)
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)

  /* ── Init ── */
  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    if (!config?.lieux?.enseignes?.length) return
    const ens = config.lieux.enseignes
    const activeId = config.lieux.active || ens[0]?.id
    setActiveEnseigne(activeId)
    const activeEns = ens.find(e => e.id === activeId) || ens[0]
    if (activeEns?.pieces?.length) setActiveRoom(activeEns.pieces[0].id)
    setLoading(false)
  }, [config])

  /* ── Fetch data when room changes ── */
  useEffect(() => {
    if (!activeEnseigne || !activeRoom || !config) return

    const ens = config.lieux.enseignes.find(e => e.id === activeEnseigne)
    const room = ens?.pieces?.find(p => p.id === activeRoom)
    if (!ens || !room) return

    const fetchData = async () => {
      try {
        const [measurements, preventive] = await Promise.all([
          apiService.getMeasurements({ enseigne: ens.nom, salle: room.nom }),
          apiService.getPreventiveActions({ enseigne: ens.nom, salle: room.nom }).catch(() => ({ actions: [] }))
        ])
        setIaqData(measurements)
        setActions(preventive.actions || [])
      } catch (err) {
        console.error('Fetch error:', err)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [activeEnseigne, activeRoom, config])

  /* ── Tab switching ── */
  const switchEnseigne = useCallback(async (ensId) => {
    setActiveEnseigne(ensId)
    const ens = config.lieux.enseignes.find(e => e.id === ensId)
    if (ens?.pieces?.length) setActiveRoom(ens.pieces[0].id)
    await saveConfig({ lieux: { ...config.lieux, active: ensId } })
  }, [config, saveConfig])

  const switchRoom = useCallback((roomId) => {
    setActiveRoom(roomId)
  }, [])

  /* ── Fullscreen ── */
  const toggleFullscreen = useCallback(async () => {
    const el = roomVisualRef.current
    if (!el) return
    if (!fullscreen) {
      try { await el.requestFullscreen() } catch {}
      setFullscreen(true)
    } else {
      try { await document.exitFullscreen() } catch {}
      setFullscreen(false)
    }
  }, [fullscreen])

  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement) setFullscreen(false) }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  /* ── Derived state ── */
  const enseignes = config?.lieux?.enseignes || []
  const currentEns = enseignes.find(e => e.id === activeEnseigne) || enseignes[0]
  const rooms = currentEns?.pieces || []
  const currentRoom = rooms.find(r => r.id === activeRoom)
  const glbUrl = currentRoom?.glbModel || null

  /* ── Helpers ── */
  const fmt = (v, dec = 1) => v != null && !isNaN(v) ? Number(v).toFixed(dec) : '--'
  const getSeverityClass = (action) => {
    if (action.priority === 'high') return 'alert-red'
    if (action.priority === 'medium') return 'alert-yellow'
    return 'alert-green'
  }

  if (loading) return <div className="page"><Navbar /><div className="loading-state"><p>Chargement…</p></div></div>

  return (
    <div className="page">
      <Navbar />

      {/* ── Tabs ── */}
      <div className="tabs-container espace-tabs">
        <div className="location-tabs">
          {enseignes.map(ens => (
            <button key={ens.id} className={`location-tab${activeEnseigne === ens.id ? ' active' : ''}`} onClick={() => switchEnseigne(ens.id)}>
              {ens.nom}
            </button>
          ))}
        </div>
        <div className="room-tabs">
          {rooms.map(r => (
            <button key={r.id} className={`room-tab${activeRoom === r.id ? ' active' : ''}`} onClick={() => switchRoom(r.id)}>
              {r.nom}
            </button>
          ))}
        </div>
      </div>

      {/* ── Twin Layout ── */}
      <main className="twin-layout">
        {/* ── Room Panel (3D Viewer) ── */}
        <section className="room-panel">
          <h2>Visualisation</h2>

          <div className="room-visual" ref={roomVisualRef}>
            <div className="blender-viewer">
              {glbUrl ? (
                <RoomViewer glbUrl={glbUrl} />
              ) : (
                <div className="no-model">
                  <p>Aucun modèle 3D configuré pour cette pièce.</p>
                  <p className="muted">Ajoutez un fichier .glb dans Paramètres &gt; Lieux</p>
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
            <button className="fullscreen-btn" onClick={toggleFullscreen} aria-label="Plein écran">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </button>

            {/* IAQ Overlay */}
            <div className="iaq-overlay">
              <div className="iaq-item"><span className="iaq-label">CO₂</span><span className="iaq-value">{fmt(iaqData?.co2, 0)}</span><span className="iaq-unit">ppm</span></div>
              <div className="iaq-item"><span className="iaq-label">PM2.5</span><span className="iaq-value">{fmt(iaqData?.pm25)}</span><span className="iaq-unit">µg/m³</span></div>
              <div className="iaq-item"><span className="iaq-label">TVOC</span><span className="iaq-value">{fmt(iaqData?.tvoc)}</span><span className="iaq-unit">mg/m³</span></div>
              <div className="iaq-item"><span className="iaq-label">Temp</span><span className="iaq-value">{fmt(iaqData?.temperature)}</span><span className="iaq-unit">°C</span></div>
              <div className="iaq-item"><span className="iaq-label">Hum</span><span className="iaq-value">{fmt(iaqData?.humidity)}</span><span className="iaq-unit">%</span></div>
            </div>

            {/* Room Label */}
            <div className="room-label">{currentRoom?.nom || ''}</div>
          </div>
        </section>

        {/* ── Actions Panel ── */}
        <section className="actions-panel">
          <div className="panel-header">
            <h2>Actions</h2>
          </div>

          <div className="table-wrapper">
            <table className="actions-table">
              <thead>
                <tr>
                  <th>État</th>
                  <th>Sujet</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {actions.length > 0 ? actions.map((action, i) => (
                  <tr key={i} className={`dynamic-alert ${getSeverityClass(action)}`}>
                    <td className="col-state">
                      <div className={`status-indicator ${action.priority === 'high' ? 'status-red' : action.priority === 'medium' ? 'status-yellow' : 'status-green'}`}></div>
                    </td>
                    <td className="col-subj">{action.device || action.parameter || '—'}</td>
                    <td className="col-act">{action.action || action.reason || '—'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Aucune action en cours</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
