import './LoadingScreen.css'

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="spinner"></div>
        <h2>IAQverse</h2>
        <p>Chargement en cours...</p>
      </div>
    </div>
  )
}
