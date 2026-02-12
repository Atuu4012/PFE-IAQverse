import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ThemeToggle from '../../components/common/ThemeToggle'
import { useThemeStore } from '../../stores/themeStore'

// Mock du store
vi.mock('../../stores/themeStore', () => ({
  useThemeStore: vi.fn()
}))

describe('ThemeToggle', () => {
  it('devrait afficher l\'icône Moon en mode light', () => {
    useThemeStore.mockReturnValue({
      theme: 'light',
      toggleTheme: vi.fn()
    })

    render(<ThemeToggle />)
    
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('title', 'Mode sombre')
  })

  it('devrait afficher l\'icône Sun en mode dark', () => {
    useThemeStore.mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn()
    })

    render(<ThemeToggle />)
    
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'Mode clair')
  })

  it('devrait appeler toggleTheme au clic', () => {
    const toggleTheme = vi.fn()
    useThemeStore.mockReturnValue({
      theme: 'light',
      toggleTheme
    })

    render(<ThemeToggle />)
    
    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(toggleTheme).toHaveBeenCalledTimes(1)
  })
})
