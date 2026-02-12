import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import './Login.css'

export default function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const { signUp, user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/')
  }, [user, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!email || !password || !confirmPassword) {
      setError('Veuillez remplir tous les champs')
      setLoading(false)
      return
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      setLoading(false)
      return
    }
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères')
      setLoading(false)
      return
    }

    const result = await signUp(email, password, { name })
    if (result.success) {
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } else {
      setError(result.error || "Erreur lors de l'inscription")
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="login-page">
        <div className="login-bg" style={{ background: "url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2000&auto=format&fit=crop') no-repeat center center", backgroundSize: 'cover' }}></div>
        <div className="login-card">
          <div className="login-header">
            <h1>Inscription réussie !</h1>
            <p>Vérifiez votre email pour confirmer votre compte.</p>
            <p style={{ marginTop: 16, fontSize: 14, color: '#64748b' }}>Redirection vers la page de connexion…</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-bg" style={{ background: "url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2000&auto=format&fit=crop') no-repeat center center", backgroundSize: 'cover' }}></div>

      <div className="login-card">
        <div className="login-header">
          <h1>Créer un compte</h1>
          <p>Rejoignez IAQverse</p>
        </div>

        {error && <div className="error-message" style={{ display: 'block' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Nom</label>
            <input id="name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Votre nom" disabled={loading} autoComplete="name" />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nom@exemple.com" disabled={loading} autoComplete="email" required />
          </div>

          <div className="form-group">
            <label htmlFor="password">Mot de passe</label>
            <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" disabled={loading} autoComplete="new-password" required />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirmer le mot de passe</label>
            <input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" disabled={loading} autoComplete="new-password" required />
          </div>

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Inscription…' : "S'inscrire"}
          </button>

          <Link to="/login" className="btn-signup">Se connecter</Link>
        </form>
      </div>
    </div>
  )
}
