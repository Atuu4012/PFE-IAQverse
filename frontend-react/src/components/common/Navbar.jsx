import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useTranslation } from 'react-i18next'
import { useState, useRef, useEffect } from 'react'
import ThemeToggle from './ThemeToggle'
import './Navbar.css'

export default function Navbar({ title }) {
  const { user, signOut } = useAuthStore()
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [accountOpen, setAccountOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const accountRef = useRef(null)

  // Determine page title
  const pageTitle = title || (() => {
    if (location.pathname === '/') return t('dashboard.title', 'Dashboard')
    if (location.pathname === '/digital-twin') return t('nav.digitalTwin', 'Jumeau Numérique')
    if (location.pathname === '/settings') return t('settings.title', 'Paramètres')
    return 'IAQverse'
  })()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  // Close account modal on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setAccountOpen(false)
      }
    }
    if (accountOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [accountOpen])

  const navItems = [
    {
      path: '/',
      label: 'Dashboard',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      ),
    },
    {
      path: '/digital-twin',
      label: 'Digital Twin',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        </svg>
      ),
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      ),
    },
  ]

  return (
    <>
      <header className="header">
        {/* Left: Navigation icons */}
        <nav className="header-nav">
          {navItems.map(({ path, icon, label }) => (
            <Link
              key={path}
              to={path}
              className={`nav-icon-link ${location.pathname === path ? 'active-page' : ''}`}
              aria-label={label}
            >
              {icon}
            </Link>
          ))}
        </nav>

        {/* Center: Page title */}
        <h1 className="header-title">{pageTitle}</h1>

        {/* Right: Action buttons */}
        <div className="header-buttons">
          <ThemeToggle />

          <button className="icon-btn" onClick={() => setInfoOpen(true)} aria-label="Information">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </button>

          <div className="header-avatar-wrapper" ref={accountRef}>
            <button 
              className="header-avatar-link" 
              onClick={() => setAccountOpen(!accountOpen)}
            >
              <img src="/assets/icons/profil.png" alt="Avatar" className="header-avatar-img" 
                onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>' }}
              />
            </button>

            {/* Account Modal */}
            {accountOpen && (
              <div className="account-modal visible">
                <div className="account-header">
                  <span>{t('account.switch', 'Changer de compte')}</span>
                  <span className="close-account" onClick={() => setAccountOpen(false)}>&times;</span>
                </div>
                <ul className="account-list">
                  <li className="account-item active">
                    <img src="/assets/icons/profil.png" className="account-avatar-small" alt=""
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                    <span>{user?.email || t('account.currentUser', 'Utilisateur Actuel')}</span>
                  </li>
                  <li className="account-divider"></li>
                  <li className="account-action" onClick={() => { setAccountOpen(false); navigate('/settings') }}>
                    <span>{t('settings.title', 'Paramètres')}</span>
                  </li>
                  <li className="account-action logout" onClick={handleSignOut}>
                    <span>{t('account.logout', 'Déconnexion')}</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Info Modal */}
      {infoOpen && (
        <div className="modal-overlay" onClick={() => setInfoOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setInfoOpen(false)}>&times;</button>
            <h2>{t('dashboard.aboutTitle', 'À propos')}</h2>
            <p>{t('dashboard.aboutParagraph', 'Visualisez la qualité de l\'air en temps réel.')}</p>
            <ul>
              <li>{t('dashboard.co2', 'CO₂')}</li>
              <li>{t('dashboard.pm25', 'PM2.5')}</li>
              <li>{t('dashboard.comfort', 'Température & Humidité')}</li>
              <li>{t('dashboard.tvoc', 'TVOC')}</li>
              <li>{t('dashboard.scoreFeature', 'Score IAQ')}</li>
              <li>{t('dashboard.predictionFeature', 'Prédiction 30 min')}</li>
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
