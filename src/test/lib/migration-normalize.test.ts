import { describe, expect, it } from 'vitest'
import { normalizeMomoNetwork, momoNetworkWasNormalized } from '@/lib/migration/normalize'

describe('normalizeMomoNetwork', () => {
  it('defaults empty values to MTN', () => {
    expect(normalizeMomoNetwork('')).toBe('MTN')
    expect(normalizeMomoNetwork(null)).toBe('MTN')
  })

  it('accepts exact valid values', () => {
    expect(normalizeMomoNetwork('MTN')).toBe('MTN')
    expect(normalizeMomoNetwork('Vodafone')).toBe('Vodafone')
    expect(normalizeMomoNetwork('AirtelTigo')).toBe('AirtelTigo')
  })

  it('maps common spreadsheet variants', () => {
    expect(normalizeMomoNetwork('mtn momo')).toBe('MTN')
    expect(normalizeMomoNetwork('Telecel')).toBe('Vodafone')
    expect(normalizeMomoNetwork('Airtel-Tigo')).toBe('AirtelTigo')
    expect(normalizeMomoNetwork('tigo cash')).toBe('AirtelTigo')
  })

  it('flags values that need normalization', () => {
    expect(momoNetworkWasNormalized('Telecel')).toBe(true)
    expect(momoNetworkWasNormalized('MTN')).toBe(false)
  })
})
