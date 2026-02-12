import { create } from 'zustand'

export const useAlertStore = create((set, get) => ({
  alerts: [],
  unreadCount: 0,
  
  // Ajouter une alerte
  addAlert: (alert) => {
    const newAlert = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      read: false,
      ...alert
    }
    
    set((state) => ({
      alerts: [newAlert, ...state.alerts],
      unreadCount: state.unreadCount + 1
    }))
    
    // Auto-dismiss après 10 secondes si type info
    if (alert.type === 'info' && alert.autoDismiss !== false) {
      setTimeout(() => {
        get().dismissAlert(newAlert.id)
      }, 10000)
    }
  },
  
  // Marquer comme lue
  markAsRead: (id) => {
    set((state) => ({
      alerts: state.alerts.map(alert =>
        alert.id === id ? { ...alert, read: true } : alert
      ),
      unreadCount: Math.max(0, state.unreadCount - 1)
    }))
  },
  
  // Marquer toutes comme lues
  markAllAsRead: () => {
    set((state) => ({
      alerts: state.alerts.map(alert => ({ ...alert, read: true })),
      unreadCount: 0
    }))
  },
  
  // Supprimer une alerte
  dismissAlert: (id) => {
    set((state) => {
      const alert = state.alerts.find(a => a.id === id)
      return {
        alerts: state.alerts.filter(a => a.id !== id),
        unreadCount: alert && !alert.read ? state.unreadCount - 1 : state.unreadCount
      }
    })
  },
  
  // Effacer toutes les alertes
  clearAll: () => {
    set({ alerts: [], unreadCount: 0 })
  },
  
  // Effacer les alertes lues
  clearRead: () => {
    set((state) => ({
      alerts: state.alerts.filter(alert => !alert.read)
    }))
  },
  
  // Créer une alerte de type spécifique
  createAlert: {
    success: (message, title = 'Succès') => {
      get().addAlert({ type: 'success', title, message })
    },
    error: (message, title = 'Erreur') => {
      get().addAlert({ type: 'error', title, message, autoDismiss: false })
    },
    warning: (message, title = 'Attention') => {
      get().addAlert({ type: 'warning', title, message })
    },
    info: (message, title = 'Information') => {
      get().addAlert({ type: 'info', title, message })
    },
  },
  
  // Traiter les alertes IAQ
  processIAQAlert: (measurement, config) => {
    const { temperature, humidity, co2, iaq_score } = measurement
    
    // Vérifier les seuils
    if (iaq_score < 40) {
      get().addAlert({
        type: 'error',
        title: 'Qualité de l\'air critique',
        message: `Score IAQ très bas: ${Math.round(iaq_score)}/100`,
        metric: 'iaq',
        value: iaq_score,
        autoDismiss: false
      })
    }
    
    if (temperature > 26) {
      get().addAlert({
        type: 'warning',
        title: 'Température élevée',
        message: `${temperature.toFixed(1)}°C - Aération recommandée`,
        metric: 'temperature',
        value: temperature
      })
    }
    
    if (co2 > 1000) {
      get().addAlert({
        type: 'warning',
        title: 'CO₂ élevé',
        message: `${Math.round(co2)} ppm - Ventilez la pièce`,
        metric: 'co2',
        value: co2
      })
    }
    
    if (humidity < 30 || humidity > 70) {
      get().addAlert({
        type: 'warning',
        title: 'Humidité hors norme',
        message: `${humidity.toFixed(1)}% - Ajustement recommandé`,
        metric: 'humidity',
        value: humidity
      })
    }
  }
}))
