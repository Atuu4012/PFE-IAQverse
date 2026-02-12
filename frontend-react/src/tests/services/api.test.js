import { describe, it, expect } from 'vitest'
import { apiService } from '../services/api'

describe('ApiService', () => {
  it('devrait construire une URL avec des paramètres', () => {
    const url = apiService.buildUrl('http://example.com/api', {
      param1: 'value1',
      param2: 'value2'
    })

    expect(url).toContain('param1=value1')
    expect(url).toContain('param2=value2')
  })

  it('devrait ignorer les paramètres null ou undefined', () => {
    const url = apiService.buildUrl('http://example.com/api', {
      param1: 'value1',
      param2: null,
      param3: undefined
    })

    expect(url).toContain('param1=value1')
    expect(url).not.toContain('param2')
    expect(url).not.toContain('param3')
  })

  it('devrait avoir les endpoints configurés', () => {
    expect(apiService).toBeDefined()
    expect(typeof apiService.get).toBe('function')
    expect(typeof apiService.post).toBe('function')
    expect(typeof apiService.put).toBe('function')
    expect(typeof apiService.delete).toBe('function')
  })
})
