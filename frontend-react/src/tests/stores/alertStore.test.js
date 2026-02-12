import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAlertStore } from '../stores/alertStore'

describe('alertStore', () => {
  beforeEach(() => {
    // Reset store
    useAlertStore.setState({
      alerts: [],
      unreadCount: 0,
    })
  })

  it('devrait initialiser avec aucune alerte', () => {
    const { result } = renderHook(() => useAlertStore())

    expect(result.current.alerts).toHaveLength(0)
    expect(result.current.unreadCount).toBe(0)
  })

  it('devrait ajouter une alerte', () => {
    const { result } = renderHook(() => useAlertStore())

    act(() => {
      result.current.addAlert({
        type: 'info',
        title: 'Test',
        message: 'Message de test'
      })
    })

    expect(result.current.alerts).toHaveLength(1)
    expect(result.current.alerts[0].title).toBe('Test')
    expect(result.current.unreadCount).toBe(1)
  })

  it('devrait marquer une alerte comme lue', () => {
    const { result } = renderHook(() => useAlertStore())

    act(() => {
      result.current.addAlert({
        type: 'info',
        title: 'Test',
        message: 'Message de test'
      })
    })

    const alertId = result.current.alerts[0].id

    act(() => {
      result.current.markAsRead(alertId)
    })

    expect(result.current.alerts[0].read).toBe(true)
    expect(result.current.unreadCount).toBe(0)
  })

  it('devrait supprimer une alerte', () => {
    const { result } = renderHook(() => useAlertStore())

    act(() => {
      result.current.addAlert({
        type: 'info',
        title: 'Test',
        message: 'Message de test'
      })
    })

    const alertId = result.current.alerts[0].id

    act(() => {
      result.current.dismissAlert(alertId)
    })

    expect(result.current.alerts).toHaveLength(0)
    expect(result.current.unreadCount).toBe(0)
  })

  it('devrait effacer toutes les alertes', () => {
    const { result } = renderHook(() => useAlertStore())

    act(() => {
      result.current.addAlert({ type: 'info', title: 'Test 1', message: 'Message 1' })
      result.current.addAlert({ type: 'warning', title: 'Test 2', message: 'Message 2' })
      result.current.addAlert({ type: 'error', title: 'Test 3', message: 'Message 3' })
    })

    expect(result.current.alerts).toHaveLength(3)

    act(() => {
      result.current.clearAll()
    })

    expect(result.current.alerts).toHaveLength(0)
    expect(result.current.unreadCount).toBe(0)
  })

  it('devrait créer des alertes avec les helpers', () => {
    const { result } = renderHook(() => useAlertStore())

    act(() => {
      result.current.createAlert.success('Opération réussie')
    })

    expect(result.current.alerts[0].type).toBe('success')
    expect(result.current.alerts[0].title).toBe('Succès')

    act(() => {
      result.current.createAlert.error('Une erreur est survenue')
    })

    expect(result.current.alerts[1].type).toBe('error')
    expect(result.current.alerts[1].title).toBe('Erreur')
  })
})
