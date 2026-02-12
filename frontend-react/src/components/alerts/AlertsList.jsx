import { X, AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react'
import { useAlertStore } from '../../stores/alertStore'
import './AlertsList.css'

export default function AlertsList({ alerts = [], compact = false }) {
  const { dismissAlert, markAsRead, clearAll, clearRead } = useAlertStore()

  const getAlertIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={20} />
      case 'error':
        return <AlertCircle size={20} />
      case 'warning':
        return <AlertTriangle size={20} />
      default:
        return <Info size={20} />
    }
  }

  const handleAlertClick = (alert) => {
    if (!alert.read) {
      markAsRead(alert.id)
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="alerts-list">
        <div className="alerts-header">
          <h3>Alertes</h3>
        </div>
        <div className="no-alerts">
          <CheckCircle size={48} />
          <p>Aucune alerte</p>
          <small>Tout fonctionne normalement</small>
        </div>
      </div>
    )
  }

  return (
    <div className="alerts-list">
      {!compact && (
        <div className="alerts-header">
          <h3>Alertes {alerts.length > 0 && `(${alerts.length})`}</h3>
          <div className="alerts-actions">
            <button onClick={clearRead} className="btn-text">
              Effacer lues
            </button>
            <button onClick={clearAll} className="btn-text">
              Tout effacer
            </button>
          </div>
        </div>
      )}
      
      <div className={`alerts-container ${compact ? 'compact' : ''}`}>
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`alert-item alert-${alert.type} ${alert.read ? 'read' : 'unread'}`}
            onClick={() => handleAlertClick(alert)}
          >
            <div className="alert-icon">
              {getAlertIcon(alert.type)}
            </div>
            
            <div className="alert-content">
              <div className="alert-title">
                {alert.title}
                {!alert.read && <span className="unread-badge"></span>}
              </div>
              <div className="alert-message">{alert.message}</div>
              {alert.timestamp && !compact && (
                <div className="alert-time">
                  {new Date(alert.timestamp).toLocaleTimeString('fr-FR')}
                </div>
              )}
            </div>
            
            <button
              className="alert-dismiss"
              onClick={(e) => {
                e.stopPropagation()
                dismissAlert(alert.id)
              }}
              title="Fermer"
            >
              <X size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
