import { create } from 'zustand'
import { supabase } from '../services/supabase'

const API_BASE = window.location.origin

/** Récupère le token JWT Supabase pour les requêtes authentifiées */
async function getAuthHeaders() {
  const headers = { 'ngrok-skip-browser-warning': 'true' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch (e) {
    console.warn('Auth token not available', e)
  }
  return headers
}

export const useConfigStore = create((set, get) => ({
  config: null,
  loading: false,
  error: null,

  // Charger la configuration depuis le backend
  loadConfig: async () => {
    try {
      set({ loading: true, error: null })

      const headers = await getAuthHeaders()
      const response = await fetch(`${API_BASE}/api/config`, {
        cache: 'no-cache',
        headers
      })
      
      if (!response.ok) {
        throw new Error('Impossible de charger la configuration')
      }
      
      const config = await response.json()
      
      set({ config, loading: false })
      return config
    } catch (error) {
      console.error('Erreur lors du chargement de la configuration:', error)
      set({ error: error.message, loading: false })
      return null
    }
  },

  // Obtenir une valeur de configuration
  getConfig: (key, defaultValue = null) => {
    const config = get().config
    if (!config) return defaultValue
    
    const keys = key.split('.')
    let value = config
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return defaultValue
      }
    }
    
    return value ?? defaultValue
  },

  // Sauvegarder la configuration sur le backend (merge partiel)
  saveConfig: async (updates) => {
    try {
      set({ loading: true, error: null })

      const headers = await getAuthHeaders()
      headers['Content-Type'] = 'application/json'

      const response = await fetch(`${API_BASE}/api/config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates)
      })
      
      if (!response.ok) {
        throw new Error('Impossible de sauvegarder la configuration')
      }
      
      const updatedConfig = await response.json()
      
      // Merge avec la config locale
      const currentConfig = get().config || {}
      const mergedConfig = deepMerge(currentConfig, updates)
      set({ config: updatedConfig || mergedConfig, loading: false })
      
      return { success: true }
    } catch (error) {
      console.error('Erreur sauvegarde config:', error)
      set({ error: error.message, loading: false })
      return { success: false, error: error.message }
    }
  },

  // Mettre à jour la config locale uniquement (pour WebSocket updates)
  updateConfigLocal: (newConfig) => {
    set({ config: newConfig })
  },
}))

// Deep merge helper
function deepMerge(target, source) {
  const output = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key])
    } else {
      output[key] = source[key]
    }
  }
  return output
}
