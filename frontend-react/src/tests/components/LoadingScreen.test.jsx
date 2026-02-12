import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import LoadingScreen from '../../components/common/LoadingScreen'

describe('LoadingScreen', () => {
  it('devrait afficher le loader', () => {
    render(<LoadingScreen />)
    
    expect(screen.getByText('IAQverse')).toBeInTheDocument()
    expect(screen.getByText('Chargement en cours...')).toBeInTheDocument()
  })

  it('devrait avoir la classe spinner', () => {
    const { container } = render(<LoadingScreen />)
    const spinner = container.querySelector('.spinner')
    
    expect(spinner).toBeInTheDocument()
  })
})
