import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAuthStore } from '../stores/authStore'

describe('authStore', () => {
  beforeEach(() => {
    // Reset store avant chaque test
    useAuthStore.setState({
      user: null,
      session: null,
      loading: false,
      initialized: false,
    })
  })

  it('devrait initialiser avec les valeurs par défaut', () => {
    const { result } = renderHook(() => useAuthStore())

    expect(result.current.user).toBeNull()
    expect(result.current.session).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.initialized).toBe(false)
  })

  it('devrait obtenir le token depuis la session', async () => {
    const { result } = renderHook(() => useAuthStore())
    
    // Simuler une session
    act(() => {
      useAuthStore.setState({
        session: {
          access_token: 'mock-token-123'
        }
      })
    })

    const token = await result.current.getToken()
    expect(token).toBe('mock-token-123')
  })

  it('devrait retourner null si aucune session', async () => {
    const { result } = renderHook(() => useAuthStore())
    
    const token = await result.current.getToken()
    expect(token).toBeNull()
  })
})
