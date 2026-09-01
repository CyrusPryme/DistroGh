import { describe, it, expect } from 'vitest'
import { formatDisplayName } from '@/lib/format-display-name'

describe('formatDisplayName', () => {
  it('title-cases all-uppercase names', () => {
    expect(formatDisplayName('CHOCHO INDUSTRIES')).toBe('Chocho Industries')
    expect(formatDisplayName('PALACE MALL')).toBe('Palace Mall')
  })

  it('preserves mixed-case names', () => {
    expect(formatDisplayName('Acme Foods Ltd')).toBe('Acme Foods Ltd')
  })

  it('handles empty values', () => {
    expect(formatDisplayName('')).toBe('—')
    expect(formatDisplayName(null)).toBe('—')
  })
})
