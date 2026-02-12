import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import './Login.css'

export default function ResetPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const { resetPassword } = useAuthStore()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!email) {
      setError('Veuillez entrer votre email')
      setLoading(false)
      return
    }

    const result = await resetPassword(email)
    if (result.success) setSuccess(true)
    else setError(result.error || "Erreur lors de l'envoi de l'email")
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-bg"></div>

      <div className="login-card">
        <div className="login-header">
          <h1>Mot de passe oublié</h1>
          <p>Entrez votre email pour recevoir un lien de réinitialisation</p>
        </div>

        {error && <div className="error-message" style={{ display: 'block' }}>{error}</div>}

        {success && (
          <div style={{ marginBottom: 20, padding: 10, borderRadius: 4, background: 'rgba(16,185,129,0.1)', color: '#10b981', fontSize: 14 }}>
            Un email de réinitialisation a été envoyé à {email}
          </div>
        )}

        {!success && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nom@exemple.com" disabled={loading} autoComplete="email" required />
            </div>

            <button type="submit" className="btn-login" disabled={loading}>
              {loading ? 'Envoi…' : 'Envoyer le lien'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/login" className="forgot-link">← Retour à la connexion</Link>
        </div>
      </div>
    </div>
  )
}
