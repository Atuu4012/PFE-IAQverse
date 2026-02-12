import { useState, useEffect, useCallback } from 'react'
import { useConfigStore } from '../stores/configStore'
import { useThemeStore } from '../stores/themeStore'
import Navbar from '../components/common/Navbar'
import './Settings.css'

/* ── helpers ─────────────────────────────────────── */
function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj)
}
function setByPath(obj, path, value) {
  const copy = JSON.parse(JSON.stringify(obj))
  const parts = path.split('.')
  let cur = copy
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]] }
  cur[parts[parts.length - 1]] = value
  return copy
}

const LANDSCAPES = [
  { value: 'garden_day.jpg', label: 'Jardin (Jour)' },
  { value: 'garden_night.jpg', label: 'Jardin (Nuit)' },
  { value: 'urban_day.jpg', label: 'Urbain (Jour)' },
  { value: 'urban_night.jpg', label: 'Urbain (Nuit)' },
]
const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
]
const ROOM_TYPES = ['salon', 'cuisine', 'chambre', 'bureau', 'autre']

/* ── notification flash ──────────────────────────── */
function showNotification(msg, isError = false) {
  let el = document.getElementById('settings-notification')
  if (!el) { el = document.createElement('div'); el.id = 'settings-notification'; el.className = 'notification'; document.body.appendChild(el) }
  el.textContent = msg
  el.style.borderColor = isError ? 'var(--danger)' : 'var(--success)'
  el.style.display = 'block'
  el.style.animation = 'slideUp .3s ease'
  clearTimeout(el._t)
  el._t = setTimeout(() => { el.style.display = 'none' }, 3000)
}

/* ════════════════════════════════════════════════════
   COMPONENT
   ════════════════════════════════════════════════════ */
export default function Settings() {
  const { config, loadConfig, saveConfig } = useConfigStore()
  const { theme, setTheme } = useThemeStore()

  const [activeSection, setActiveSection] = useState('compte')
  const [localConfig, setLocalConfig] = useState(null)

  // ── modals ──
  const [passwordModal, setPasswordModal] = useState(false)
  const [editModal, setEditModal] = useState(null)        // { title, fields[], onSubmit }
  const [deleteModal, setDeleteModal] = useState(false)

  /* ── init ── */
  useEffect(() => { loadConfig() }, [loadConfig])
  useEffect(() => { if (config) setLocalConfig(JSON.parse(JSON.stringify(config))) }, [config])

  /* ── save helper ── */
  const doSave = useCallback(async (updates) => {
    try {
      await saveConfig(updates)
      showNotification('Modification sauvegardée')
    } catch { showNotification('Erreur lors de la sauvegarde', true) }
  }, [saveConfig])

  const saveCardFields = useCallback(async (cardEl) => {
    if (!cardEl || !localConfig) return
    const inputs = cardEl.querySelectorAll('[data-path]')
    let updated = { ...localConfig }
    inputs.forEach(input => {
      const path = input.getAttribute('data-path')
      const val = input.type === 'checkbox' ? input.checked : input.value
      updated = setByPath(updated, path, val)
    })
    setLocalConfig(updated)
    await doSave(updated)
  }, [localConfig, doSave])

  if (!localConfig) return <div className="page"><Navbar /><div className="loading-state"><p>Chargement…</p></div></div>

  const val = (path) => getByPath(localConfig, path) ?? ''
  const setVal = (path, v) => setLocalConfig(prev => setByPath(prev, path, v))

  /* ── Enseignes CRUD ── */
  const enseignes = localConfig?.lieux?.enseignes || []

  const addEnseigne = () => {
    setEditModal({
      title: 'Ajouter une enseigne',
      fields: [
        { label: 'Nom', name: 'nom', type: 'text', required: true },
        { label: 'Adresse', name: 'adresse', type: 'text' },
      ],
      onSubmit: async (data) => {
        if (enseignes.some(e => e.nom?.toLowerCase() === data.nom?.toLowerCase())) {
          showNotification('Une enseigne avec ce nom existe déjà', true); return
        }
        const newE = { id: 'ens_' + Date.now(), nom: data.nom, adresse: data.adresse || '', pieces: [] }
        const newList = [...enseignes, newE]
        const updated = setByPath(setByPath(localConfig, 'lieux.enseignes', newList), 'lieux.active', newE.id)
        setLocalConfig(updated)
        await doSave(updated)
        setEditModal(null)
      }
    })
  }

  const editEnseigne = (ens) => {
    setEditModal({
      title: 'Modifier l\'enseigne',
      fields: [
        { label: 'Nom', name: 'nom', type: 'text', required: true, defaultValue: ens.nom },
        { label: 'Adresse', name: 'adresse', type: 'text', defaultValue: ens.adresse || '' },
      ],
      onSubmit: async (data) => {
        const newList = enseignes.map(e => e.id === ens.id ? { ...e, nom: data.nom, adresse: data.adresse } : e)
        const updated = setByPath(localConfig, 'lieux.enseignes', newList)
        setLocalConfig(updated)
        await doSave(updated)
        setEditModal(null)
      }
    })
  }

  const removeEnseigne = async (ensId) => {
    if (!window.confirm('Supprimer cette enseigne ?')) return
    const newList = enseignes.filter(e => e.id !== ensId)
    let updated = setByPath(localConfig, 'lieux.enseignes', newList)
    if (localConfig.lieux?.active === ensId) updated = setByPath(updated, 'lieux.active', newList[0]?.id || null)
    setLocalConfig(updated)
    await doSave(updated)
  }

  const addPiece = (ensId) => {
    setEditModal({
      title: 'Ajouter une pièce',
      fields: [
        { label: 'Nom de la pièce', name: 'nom', type: 'text', required: true },
        { label: 'Type', name: 'type', type: 'select', options: ROOM_TYPES, defaultValue: 'salon' },
      ],
      onSubmit: async (data) => {
        const piece = { id: 'piece_' + Date.now(), nom: data.nom, type: data.type || 'salon' }
        const newList = enseignes.map(e => e.id === ensId ? { ...e, pieces: [...(e.pieces || []), piece] } : e)
        const updated = setByPath(localConfig, 'lieux.enseignes', newList)
        setLocalConfig(updated)
        await doSave(updated)
        setEditModal(null)
      }
    })
  }

  const removePiece = async (ensId, pieceId) => {
    if (!window.confirm('Supprimer cette pièce ?')) return
    const newList = enseignes.map(e => e.id === ensId ? { ...e, pieces: (e.pieces || []).filter(p => p.id !== pieceId) } : e)
    const updated = setByPath(localConfig, 'lieux.enseignes', newList)
    setLocalConfig(updated)
    await doSave(updated)
  }

  const selectPlan = async (plan) => {
    if (plan === 'entreprise') { showNotification('Contactez-nous pour le plan Entreprise'); return }
    const updated = setByPath(localConfig, 'abonnement.plan_actuel', plan)
    setLocalConfig(updated)
    await doSave(updated)
  }

  const currentPlan = val('abonnement.plan_actuel') || ''

  /* ── Render ── */
  const menuItems = [
    { id: 'compte', label: 'Compte' },
    { id: 'affichage', label: 'Affichage' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'lieux', label: 'Lieux' },
    { id: 'abonnement', label: 'Abonnement' },
    { id: 'contact', label: 'Contact' },
  ]

  return (
    <div className="page">
      <Navbar />

      <div className="settings-layout">
        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="section-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <h2>IAQverse</h2>
          </div>
          <ul className="menu">
            {menuItems.map(m => (
              <li key={m.id} className={activeSection === m.id ? 'active' : ''} onClick={() => setActiveSection(m.id)}>{m.label}</li>
            ))}
          </ul>
        </aside>

        {/* ── Main Content ── */}
        <main className="settings-content">

          {/* ═══ COMPTE ═══ */}
          {activeSection === 'compte' && (
            <div className="section active">
              <h1>Compte</h1>

              {/* Vous */}
              <div className="settings-card" id="card-vous">
                <div className="card-header"><h3>Vous</h3></div>
                <div className="card-body">
                  <div className="form-row">
                    <div className="form-col">
                      <FormField label="Nom" path="vous.nom" value={val('vous.nom')} onChange={v => setVal('vous.nom', v)} />
                      <FormField label="Prénom" path="vous.prenom" value={val('vous.prenom')} onChange={v => setVal('vous.prenom', v)} />
                      <FormField label="Date de naissance" path="vous.date_naissance" type="date" value={val('vous.date_naissance')} onChange={v => setVal('vous.date_naissance', v)} />
                      <FormField label="Email" path="vous.email" type="email" value={val('vous.email')} onChange={v => setVal('vous.email', v)} />
                      <FormField label="Téléphone" path="vous.telephone" type="tel" value={val('vous.telephone')} onChange={v => setVal('vous.telephone', v)} />
                      <FormField label="Adresse" path="vous.adresse" value={val('vous.adresse')} onChange={v => setVal('vous.adresse', v)} />
                    </div>
                    <div className="avatar-col">
                      <div className="avatar-preview">
                        <img src={val('vous.avatar') || '/assets/icons/profil.png'} alt="Avatar" onError={e => { e.target.src = '/assets/icons/profil.png' }} />
                      </div>
                      <button className="btn-primary btn-sm" onClick={() => document.getElementById('avatar-upload')?.click()}>Importer</button>
                      <input type="file" id="avatar-upload" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return
                        const fd = new FormData(); fd.append('file', file)
                        try {
                          const r = await fetch('/api/uploadAvatar', { method: 'POST', body: fd })
                          if (r.ok) { const d = await r.json(); if (d.path) { setVal('vous.avatar', d.path); await doSave(setByPath(localConfig, 'vous.avatar', d.path)) } }
                        } catch { showNotification('Erreur upload avatar', true) }
                      }} />
                    </div>
                  </div>
                  <div className="card-actions">
                    <button className="btn-primary" onClick={(e) => saveCardFields(e.target.closest('.settings-card'))}>Enregistrer</button>
                    <button className="btn-secondary" onClick={() => setPasswordModal(true)}>Changer le mot de passe</button>
                  </div>
                </div>
              </div>

              {/* Assurance */}
              <div className="settings-card" id="card-assurance">
                <div className="card-header"><h3>Votre assurance</h3></div>
                <div className="card-body">
                  <FormField label="Nom" path="assurance.nom" value={val('assurance.nom')} onChange={v => setVal('assurance.nom', v)} />
                  <FormField label="Email" path="assurance.email" type="email" value={val('assurance.email')} onChange={v => setVal('assurance.email', v)} />
                  <FormField label="Téléphone" path="assurance.telephone" type="tel" value={val('assurance.telephone')} onChange={v => setVal('assurance.telephone', v)} />
                  <FormField label="Adresse" path="assurance.adresse" value={val('assurance.adresse')} onChange={v => setVal('assurance.adresse', v)} />
                  <div className="card-actions">
                    <button className="btn-primary" onClick={(e) => saveCardFields(e.target.closest('.settings-card'))}>Enregistrer</button>
                  </div>
                </div>
              </div>

              {/* Syndicat */}
              <div className="settings-card" id="card-syndicat">
                <div className="card-header"><h3>Votre syndicat</h3></div>
                <div className="card-body">
                  <FormField label="Nom" path="syndicat.nom" value={val('syndicat.nom')} onChange={v => setVal('syndicat.nom', v)} />
                  <FormField label="Email" path="syndicat.email" type="email" value={val('syndicat.email')} onChange={v => setVal('syndicat.email', v)} />
                  <FormField label="Téléphone" path="syndicat.telephone" type="tel" value={val('syndicat.telephone')} onChange={v => setVal('syndicat.telephone', v)} />
                  <FormField label="Adresse" path="syndicat.adresse" value={val('syndicat.adresse')} onChange={v => setVal('syndicat.adresse', v)} />
                  <div className="form-group checkbox-group" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                    <label className="checkbox-label">
                      <input type="checkbox" data-path="alert_system.email_notifications" checked={!!val('alert_system.email_notifications')} onChange={e => setVal('alert_system.email_notifications', e.target.checked)} />
                      <span>Activer les alertes email critiques</span>
                    </label>
                  </div>
                  <div className="card-actions">
                    <button className="btn-primary" onClick={(e) => saveCardFields(e.target.closest('.settings-card'))}>Enregistrer</button>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="danger-zone">
                <h4>Zone de danger</h4>
                <p>La suppression de votre compte est irréversible.</p>
                <button className="btn-danger" onClick={() => setDeleteModal(true)}>Supprimer mon compte</button>
              </div>
            </div>
          )}

          {/* ═══ AFFICHAGE ═══ */}
          {activeSection === 'affichage' && (
            <div className="section active">
              <h1>Affichage</h1>

              <div className="settings-card">
                <div className="card-header"><h3>Jumeau Numérique</h3></div>
                <div className="card-body">
                  <div className="form-group">
                    <label>Paysage</label>
                    <select className="form-control" value={val('digital_twin.landscape') || ''} onChange={e => setVal('digital_twin.landscape', e.target.value)}>
                      {LANDSCAPES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                      <input type="checkbox" checked={!!val('digital_twin.auto_day_night')} onChange={e => setVal('digital_twin.auto_day_night', e.target.checked)} />
                      <span>Mode Jour/Nuit Automatique</span>
                    </label>
                  </div>
                  <div className="card-actions">
                    <button className="btn-primary" onClick={() => doSave(localConfig)}>Enregistrer</button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="card-header"><h3>Mode</h3></div>
                <div className="card-body">
                  <div className="form-group">
                    <label>Thème</label>
                    <select className="form-control" value={theme} onChange={e => { setTheme(e.target.value); setVal('affichage.mode', e.target.value) }}>
                      <option value="clair">Clair</option>
                      <option value="sombre">Sombre</option>
                    </select>
                  </div>
                  <div className="card-actions">
                    <button className="btn-primary" onClick={() => doSave(setByPath(localConfig, 'affichage.mode', theme))}>Enregistrer</button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="card-header"><h3>Langue &amp; Localisation</h3></div>
                <div className="card-body">
                  <div className="form-group">
                    <label>Langue</label>
                    <select className="form-control" value={val('affichage.langue') || 'fr'} onChange={e => setVal('affichage.langue', e.target.value)}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <FormField label="Localisation" path="affichage.localisation" value={val('affichage.localisation')} onChange={v => setVal('affichage.localisation', v)} />
                  <div className="card-actions">
                    <button className="btn-primary" onClick={() => doSave(localConfig)}>Enregistrer</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ NOTIFICATIONS ═══ */}
          {activeSection === 'notifications' && (
            <div className="section active">
              <h1>Notifications</h1>

              <div className="settings-card">
                <div className="card-header"><h3>Canaux</h3></div>
                <div className="card-body">
                  {['email', 'sms', 'push'].map(ch => (
                    <div className="form-group checkbox-group" key={ch}>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={!!val(`notifications.technologies.${ch}`)} onChange={e => setVal(`notifications.technologies.${ch}`, e.target.checked)} />
                        <span>{ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
                      </label>
                    </div>
                  ))}
                  <div className="card-actions">
                    <button className="btn-primary" onClick={() => doSave(localConfig)}>Enregistrer</button>
                  </div>
                </div>
              </div>

              <div className="settings-card">
                <div className="card-header"><h3>Types</h3></div>
                <div className="card-body">
                  {['alertes', 'rappels', 'newsletters'].map(tp => (
                    <div className="form-group checkbox-group" key={tp}>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={!!val(`notifications.types.${tp}`)} onChange={e => setVal(`notifications.types.${tp}`, e.target.checked)} />
                        <span>{tp.charAt(0).toUpperCase() + tp.slice(1)}</span>
                      </label>
                    </div>
                  ))}
                  <div className="card-actions">
                    <button className="btn-primary" onClick={() => doSave(localConfig)}>Enregistrer</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ LIEUX ═══ */}
          {activeSection === 'lieux' && (
            <div className="section active">
              <h1>Lieux</h1>

              <div className="settings-card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3>Gestion des enseignes</h3>
                  <button className="btn-primary btn-sm" onClick={addEnseigne} aria-label="Ajouter">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </div>
                <div className="card-body">
                  <div className="locations-grid">
                    {enseignes.map(ens => (
                      <div className={`location-card${localConfig.lieux?.active === ens.id ? ' active' : ''}`} key={ens.id}>
                        <div className="actions">
                          <button onClick={() => editEnseigne(ens)} title="Modifier">✏️</button>
                          <button onClick={() => removeEnseigne(ens.id)} title="Supprimer">🗑️</button>
                        </div>
                        <h3>{ens.nom || '—'}</h3>
                        <p className="muted">{ens.adresse || ''}</p>
                        <div className="rooms">
                          {(ens.pieces || []).map(p => (
                            <span className="room-tag" key={p.id}>
                              {p.nom}
                              <button className="remove-btn" onClick={() => removePiece(ens.id, p.id)}>×</button>
                            </span>
                          ))}
                        </div>
                        <button className="btn-room" onClick={() => addPiece(ens.id)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                          <span>Ajouter une pièce</span>
                        </button>
                      </div>
                    ))}
                    {enseignes.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Aucune enseigne configurée.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ ABONNEMENT ═══ */}
          {activeSection === 'abonnement' && (
            <div className="section active">
              <h1>Abonnement</h1>

              <div className="settings-card">
                <div className="card-header"><h3>Votre abonnement</h3></div>
                <div className="card-body">
                  <div className="form-group">
                    <label>Plan actuel</label>
                    <div className="form-control-static" style={{ fontWeight: 600, fontSize: '1.125rem' }}>
                      {currentPlan ? currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1) : '—'}
                    </div>
                  </div>

                  <div className="plans-container">
                    {/* Basic */}
                    <div className={`plan-card${currentPlan === 'basic' ? ' selected' : ''}`} data-plan="basic">
                      <h3>Basic</h3>
                      <div className="plan-price">49 €<span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>/mois</span></div>
                      <p>Plan de base avec fonctionnalités essentielles</p>
                      <ul>
                        <li>Monitoring de base</li>
                        <li>Alertes simples</li>
                        <li>Rapports mensuels</li>
                        <li>1 utilisateur</li>
                      </ul>
                      <button className="plan-btn" onClick={() => selectPlan('basic')}>{currentPlan === 'basic' ? 'Sélectionné' : 'Sélectionner'}</button>
                    </div>

                    {/* Pro */}
                    <div className={`plan-card${currentPlan === 'pro' ? ' selected' : ''}`} data-plan="pro">
                      <h3>Pro</h3>
                      <div className="plan-price">
                        <span className="price-current">79 €</span>
                        <span className="price-old">99 €</span>
                        <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>/mois</span>
                      </div>
                      <p>Plan professionnel avec fonctionnalités avancées</p>
                      <ul>
                        <li>Monitoring avancé</li>
                        <li>Alertes personnalisées</li>
                        <li>Rapports temps réel</li>
                        <li>Accès API</li>
                        <li>10 utilisateurs</li>
                      </ul>
                      <button className="plan-btn" onClick={() => selectPlan('pro')}>{currentPlan === 'pro' ? 'Sélectionné' : 'Sélectionner'}</button>
                    </div>

                    {/* Entreprise */}
                    <div className={`plan-card${currentPlan === 'entreprise' ? ' selected' : ''}`} data-plan="entreprise">
                      <h3>Entreprise</h3>
                      <div className="plan-price">Sur devis</div>
                      <p>Solution complète pour grandes organisations</p>
                      <ul>
                        <li>Monitoring avancé</li>
                        <li>Intégrations personnalisées</li>
                        <li>Utilisateurs illimités</li>
                        <li>Formation équipe</li>
                        <li>Support 24/7</li>
                        <li>SLA garanti</li>
                      </ul>
                      <button className="plan-btn" onClick={() => selectPlan('entreprise')}>{currentPlan === 'entreprise' ? 'Sélectionné' : 'Sélectionner'}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ CONTACT ═══ */}
          {activeSection === 'contact' && (
            <div className="section active">
              <h1>Contact</h1>
              <div className="settings-card">
                <div className="card-header"><h3>Nous contacter</h3></div>
                <div className="card-body">
                  <div className="form-group">
                    <label>Email</label>
                    <input type="text" className="form-control" value="support@iaqverse.com" readOnly />
                  </div>
                  <div className="form-group">
                    <label>Téléphone</label>
                    <input type="text" className="form-control" value="+33 1 23 45 67 89" readOnly />
                  </div>
                  <div className="form-group">
                    <label>Adresse</label>
                    <input type="text" className="form-control" value="38 Rue Molière, 94200 Ivry-sur-Seine" readOnly />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Edit Modal ── */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <span className="close" onClick={() => setEditModal(null)}>&times;</span>
            <h2>{editModal.title}</h2>
            <form style={{ padding: 20 }} onSubmit={e => {
              e.preventDefault()
              const fd = new FormData(e.target)
              const data = Object.fromEntries(fd)
              editModal.onSubmit(data)
            }}>
              {editModal.fields.map(f => (
                <div className="form-group" key={f.name}>
                  <label>{f.label}</label>
                  {f.type === 'select' ? (
                    <select name={f.name} className="form-control" defaultValue={f.defaultValue}>
                      {(f.options || []).map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                    </select>
                  ) : (
                    <input name={f.name} type={f.type || 'text'} className="form-control" defaultValue={f.defaultValue || ''} required={f.required} />
                  )}
                </div>
              ))}
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditModal(null)}>Annuler</button>
                <button type="submit" className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Password Modal ── */}
      {passwordModal && (
        <div className="modal-overlay" onClick={() => setPasswordModal(false)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <span className="close" onClick={() => setPasswordModal(false)}>&times;</span>
            <h2>Changer le mot de passe</h2>
            <form style={{ padding: 20 }} onSubmit={e => {
              e.preventDefault()
              const fd = new FormData(e.target)
              if (fd.get('new') !== fd.get('confirm')) { showNotification('Les mots de passe ne correspondent pas', true); return }
              showNotification('Mot de passe mis à jour')
              setPasswordModal(false)
            }}>
              <div className="form-group"><label>Ancien mot de passe</label><input name="old" type="password" className="form-control" required /></div>
              <div className="form-group"><label>Nouveau mot de passe</label><input name="new" type="password" className="form-control" required minLength={6} /></div>
              <div className="form-group"><label>Confirmer</label><input name="confirm" type="password" className="form-control" required minLength={6} /></div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setPasswordModal(false)}>Annuler</button>
                <button type="submit" className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Account Modal ── */}
      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(false)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <span className="close" onClick={() => setDeleteModal(false)}>&times;</span>
            <h2 style={{ color: 'var(--danger)' }}>Supprimer le compte</h2>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: '0.875rem', marginBottom: 12 }}>Êtes-vous sûr de vouloir supprimer définitivement votre compte ?</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--danger)', marginBottom: 20 }}>Cette action est irréversible.</p>
              <div className="form-group">
                <label>Confirmez votre mot de passe :</label>
                <input type="password" className="form-control" id="delete-password" />
              </div>
              <div className="form-actions" style={{ padding: 0, border: 'none', marginTop: 20 }}>
                <button className="btn-secondary" onClick={() => setDeleteModal(false)}>Annuler</button>
                <button className="btn-danger" onClick={() => { showNotification('Suppression du compte…'); setDeleteModal(false) }}>Confirmer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Reusable FormField ── */
function FormField({ label, path, type = 'text', value, onChange }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input
        type={type}
        className="form-control"
        data-path={path}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
