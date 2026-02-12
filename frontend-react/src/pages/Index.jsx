export default function Index() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      flexDirection: 'column',
      gap: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAlign: 'center',
      padding: '20px'
    }}>
      <h1 style={{ fontSize: '48px', margin: 0 }}>🌬️ IAQverse</h1>
      <p style={{ fontSize: '20px', color: '#666', maxWidth: '600px' }}>
        Application React 19.2 pour la gestion de la qualité de l'air intérieur
      </p>
      <div style={{ 
        background: '#f0f4f8', 
        padding: '20px 30px', 
        borderRadius: '12px',
        marginTop: '20px'
      }}>
        <p style={{ margin: 0, fontSize: '16px' }}>
          👉 Consultez <code style={{ 
            background: '#e2e8f0', 
            padding: '4px 8px', 
            borderRadius: '4px',
            fontFamily: 'monospace'
          }}>MIGRATION.md</code> pour démarrer
        </p>
      </div>
    </div>
  )
}
