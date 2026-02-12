/**
 * Service API pour IAQverse
 * Gère toutes les communications avec le backend
 */
import { supabase } from './supabase'

const API_BASE_URL = window.location.origin

export const API_ENDPOINTS = {
  // Health & Monitoring
  health: `${API_BASE_URL}/health`,
  
  // Mesures IAQ
  measurements: `${API_BASE_URL}/api/iaq/data`,
  measurementsRaw: `${API_BASE_URL}/api/iaq/data?raw=true`,
  
  // Ingestion
  ingest: `${API_BASE_URL}/api/ingest`,
  ingestIaq: `${API_BASE_URL}/api/iaq`,
  
  // Configuration
  config: `${API_BASE_URL}/api/config`,
  
  // Prédictions ML
  predictScore: `${API_BASE_URL}/api/predict/score`,
  preventiveActions: `${API_BASE_URL}/api/predict/preventive-actions`,
  
  // WebSocket
  websocket: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
  websocketStats: `${API_BASE_URL}/ws/stats`,
}

/**
 * Classe pour gérer les requêtes API avec retry automatique
 */
class ApiService {
  constructor() {
    this.maxRetries = 3
    this.retryDelay = 1000
  }

  /**
   * Construit une URL avec des paramètres de requête
   */
  buildUrl(endpoint, params = {}) {
    const url = new URL(endpoint)
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.append(key, params[key])
      }
    })
    return url.toString()
  }

  /**
   * Effectue une requête avec retry automatique
   */
  async fetchWithRetry(url, options = {}, retries = this.maxRetries) {
    try {
      // Récupérer le token JWT Supabase
      let authToken = null
      try {
        const { data } = await supabase.auth.getSession()
        authToken = data.session?.access_token
      } catch (_) {}

      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          ...options.headers,
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      if (retries > 0) {
        console.warn(`Tentative ${this.maxRetries - retries + 1}/${this.maxRetries} échouée, nouvelle tentative...`)
        await new Promise(resolve => setTimeout(resolve, this.retryDelay))
        return this.fetchWithRetry(url, options, retries - 1)
      }
      throw error
    }
  }

  /**
   * GET request
   */
  async get(endpoint, params = {}) {
    const url = this.buildUrl(endpoint, params)
    return this.fetchWithRetry(url, { method: 'GET' })
  }

  /**
   * POST request
   */
  async post(endpoint, data = {}, params = {}) {
    const url = this.buildUrl(endpoint, params)
    return this.fetchWithRetry(url, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /**
   * PUT request
   */
  async put(endpoint, data = {}, params = {}) {
    const url = this.buildUrl(endpoint, params)
    return this.fetchWithRetry(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  /**
   * DELETE request
   */
  async delete(endpoint, params = {}) {
    const url = this.buildUrl(endpoint, params)
    return this.fetchWithRetry(url, { method: 'DELETE' })
  }

  // === Méthodes spécifiques ===

  /**
   * Récupérer les dernières mesures IAQ
   */
  async getMeasurements(params = {}) {
    return this.get(API_ENDPOINTS.measurements, params)
  }

  /**
   * Récupérer les mesures brutes
   */
  async getRawMeasurements(params = {}) {
    return this.get(API_ENDPOINTS.measurementsRaw, params)
  }

  /**
   * Envoyer des données d'ingestion
   */
  async sendIngest(data) {
    return this.post(API_ENDPOINTS.ingest, data)
  }

  /**
   * Récupérer la configuration
   */
  async getConfig() {
    return this.get(API_ENDPOINTS.config)
  }

  /**
   * Prédire le score IAQ
   */
  async predictScore(data) {
    return this.post(API_ENDPOINTS.predictScore, data)
  }

  /**
   * Récupérer les actions préventives
   */
  async getPreventiveActions(params = {}) {
    return this.get(API_ENDPOINTS.preventiveActions, params)
  }

  /**
   * Health check
   */
  async healthCheck() {
    return this.get(API_ENDPOINTS.health)
  }

  /**
   * WebSocket stats
   */
  async getWebSocketStats() {
    return this.get(API_ENDPOINTS.websocketStats)
  }
}

export const apiService = new ApiService()
