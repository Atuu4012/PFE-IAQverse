import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AlertsList from '../../components/alerts/AlertsList'
import { useAlertStore } from '../../stores/alertStore'

// Mock du store
vi.mock('../../stores/alertStore', () => ({
  useAlertStore: vi.fn()
}))

describe('AlertsList', () => {
  it('devrait afficher "Aucune alerte" quand vide', () => {
    useAlertStore.mockReturnValue({
      dismissAlert: vi.fn(),
      markAsRead: vi.fn(),
      clearAll: vi.fn(),
      clearRead: vi.fn(),
    })

    render(<AlertsList alerts={[]} />)
    
    expect(screen.getByText('Aucune alerte')).toBeInTheDocument()
    expect(screen.getByText('Tout fonctionne normalement')).toBeInTheDocument()
  })

  it('devrait afficher les alertes', () => {
    const alerts = [
      {
        id: 1,
        type: 'info',
        title: 'Test Alert',
        message: 'Test message',
        read: false,
        timestamp: new Date().toISOString()
      }
    ]

    useAlertStore.mockReturnValue({
      dismissAlert: vi.fn(),
      markAsRead: vi.fn(),
      clearAll: vi.fn(),
      clearRead: vi.fn(),
    })

    render(<AlertsList alerts={alerts} />)
    
    expect(screen.getByText('Test Alert')).toBeInTheDocument()
    expect(screen.getByText('Test message')).toBeInTheDocument()
  })

  it('devrait appeler markAsRead au clic', () => {
    const markAsRead = vi.fn()
    const alerts = [
      {
        id: 1,
        type: 'info',
        title: 'Test',
        message: 'Message',
        read: false,
        timestamp: new Date().toISOString()
      }
    ]

    useAlertStore.mockReturnValue({
      dismissAlert: vi.fn(),
      markAsRead,
      clearAll: vi.fn(),
      clearRead: vi.fn(),
    })

    render(<AlertsList alerts={alerts} />)
    
    const alertItem = screen.getByText('Test').closest('.alert-item')
    fireEvent.click(alertItem)

    expect(markAsRead).toHaveBeenCalledWith(1)
  })

  it('devrait appeler dismissAlert au clic sur fermer', () => {
    const dismissAlert = vi.fn()
    const alerts = [
      {
        id: 1,
        type: 'info',
        title: 'Test',
        message: 'Message',
        read: false,
        timestamp: new Date().toISOString()
      }
    ]

    useAlertStore.mockReturnValue({
      dismissAlert,
      markAsRead: vi.fn(),
      clearAll: vi.fn(),
      clearRead: vi.fn(),
    })

    render(<AlertsList alerts={alerts} />)
    
    const dismissBtn = screen.getByTitle('Fermer')
    fireEvent.click(dismissBtn)

    expect(dismissAlert).toHaveBeenCalledWith(1)
  })
})
