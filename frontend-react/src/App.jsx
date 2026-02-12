import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthStore } from './stores/authStore'
import { useConfigStore } from './stores/configStore'
import { useThemeStore } from './stores/themeStore'

// Pages
import Login from './pages/Login'
import Signup from './pages/Signup'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import DigitalTwin from './pages/DigitalTwin'
import Settings from './pages/Settings'

// Components
import ProtectedRoute from './components/common/ProtectedRoute'
import LoadingScreen from './components/common/LoadingScreen'

function App() {
  const { initialized, loading, checkAuth, user } = useAuthStore()
  const { loadConfig } = useConfigStore()
  const { theme } = useThemeStore()

  useEffect(() => {
    // Vérifier l'authentification d'abord, puis charger la config
    const init = async () => {
      await checkAuth()
    }
    init()
  }, [])

  // Charger la config une fois l'utilisateur authentifié
  useEffect(() => {
    if (initialized && user) {
      loadConfig()
    }
  }, [initialized, user])

  useEffect(() => {
    // Appliquer le thème
    if (theme === 'sombre') {
      document.documentElement.setAttribute('data-theme', 'sombre')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  if (!initialized || loading) {
    return <LoadingScreen />
  }

  return (
    <Router>
      <Routes>
        {/* Routes publiques */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Routes protégées */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/digital-twin"
          element={
            <ProtectedRoute>
              <DigitalTwin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />

        {/* Redirection par défaut */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

export default App
