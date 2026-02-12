import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

export default function ProtectedRoute({ children }) {
  const { user, initialized } = useAuthStore()

  if (!initialized) {
    return null // Ou un loader
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
