import { create } from 'zustand'

export const useWebSocketStore = create((set, get) => ({
  ws: null,
  isConnected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  subscriptions: new Set(['measurements']),
  listeners: new Map(),
  data: {},

  // Connecter au WebSocket
  connect: () => {
    const state = get()
    
    if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    
    console.log('🔌 Connexion WebSocket:', wsUrl)

    try {
      const ws = new WebSocket(wsUrl)

      // Timeout de connexion : si pas d'ouverture en 5s, on ferme
      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('⏱️ WebSocket timeout, fermeture…')
          ws.close()
        }
      }, 5000)

      ws.onopen = () => {
        clearTimeout(connectTimeout)
        console.log('✅ WebSocket connecté')
        set({ 
          ws, 
          isConnected: true, 
          reconnectAttempts: 0 
        })
        
        // S'abonner aux topics
        const subscriptions = get().subscriptions
        if (subscriptions.size > 0) {
          ws.send(JSON.stringify({
            type: 'subscribe',
            topics: Array.from(subscriptions)
          }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          const { type, topic, data } = message

          // Mettre à jour les données
          if (topic) {
            set((state) => ({
              data: {
                ...state.data,
                [topic]: data
              }
            }))
          }

          // Notifier les listeners
          const listeners = get().listeners.get(topic) || []
          listeners.forEach(callback => {
            try {
              callback(data, message)
            } catch (error) {
              console.error('Erreur dans le listener WebSocket:', error)
            }
          })
        } catch (error) {
          console.error('Erreur parsing message WebSocket:', error)
        }
      }

      ws.onerror = (error) => {
        console.error('❌ Erreur WebSocket:', error)
      }

      ws.onclose = () => {
        console.log('🔌 WebSocket déconnecté')
        set({ isConnected: false, ws: null })
        
        // Tentative de reconnexion
        const { reconnectAttempts, maxReconnectAttempts } = get()
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
          console.log(`🔄 Reconnexion dans ${delay}ms (tentative ${reconnectAttempts + 1}/${maxReconnectAttempts})`)
          
          setTimeout(() => {
            set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }))
            get().connect()
          }, delay)
        }
      }

      set({ ws })
    } catch (error) {
      console.error('Erreur création WebSocket:', error)
    }
  },

  // Déconnecter
  disconnect: () => {
    const ws = get().ws
    if (ws) {
      ws.close()
    }
    set({ 
      ws: null, 
      isConnected: false, 
      reconnectAttempts: 0,
      data: {} 
    })
  },

  // S'abonner à un topic
  subscribe: (topics) => {
    const topicsArray = Array.isArray(topics) ? topics : [topics]
    
    set((state) => ({
      subscriptions: new Set([...state.subscriptions, ...topicsArray])
    }))

    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        topics: topicsArray
      }))
    }
  },

  // Se désabonner d'un topic
  unsubscribe: (topics) => {
    const topicsArray = Array.isArray(topics) ? topics : [topics]
    
    set((state) => {
      const newSubscriptions = new Set(state.subscriptions)
      topicsArray.forEach(topic => newSubscriptions.delete(topic))
      return { subscriptions: newSubscriptions }
    })

    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'unsubscribe',
        topics: topicsArray
      }))
    }
  },

  // Ajouter un listener pour un topic
  addListener: (topic, callback) => {
    set((state) => {
      const listeners = new Map(state.listeners)
      const topicListeners = listeners.get(topic) || []
      listeners.set(topic, [...topicListeners, callback])
      return { listeners }
    })
  },

  // Supprimer un listener
  removeListener: (topic, callback) => {
    set((state) => {
      const listeners = new Map(state.listeners)
      const topicListeners = listeners.get(topic) || []
      listeners.set(topic, topicListeners.filter(cb => cb !== callback))
      return { listeners }
    })
  },

  // Obtenir les données d'un topic
  getData: (topic) => {
    return get().data[topic]
  },
}))
