/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { computeMarkupPercent, formatMarkupPercentLabel } from '@/lib/product-pricing'

describe('computeMarkupPercent', () => {
  it('returns (selling − cost) / cost × 100', () => {
    expect(computeMarkupPercent(35, 30)).toBeCloseTo((5 / 30) * 100, 8)
    expect(computeMarkupPercent(34.5, 30)).toBe(15)
  })

  it('accepts numeric strings from Postgres', () => {
    expect(computeMarkupPercent('35.00', '30.00')).toBeCloseTo((5 / 30) * 100, 8)
  })

  it('returns null when cost is missing, zero, or non-finite', () => {
    expect(computeMarkupPercent(35, 0)).toBeNull()
    expect(computeMarkupPercent(35, null)).toBeNull()
    expect(computeMarkupPercent(35, undefined)).toBeNull()
    expect(computeMarkupPercent(35, Number.NaN)).toBeNull()
    expect(computeMarkupPercent(Number.NaN, 30)).toBeNull()
  })

  it('returns 0 when selling equals cost', () => {
    expect(computeMarkupPercent(30, 30)).toBe(0)
  })
})

describe('formatMarkupPercentLabel', () => {
  it('adds a plus sign and drops trailing .0', () => {
    expect(formatMarkupPercentLabel(15)).toBe('+15%')
    expect(formatMarkupPercentLabel(15.04)).toBe('+15%')
    expect(formatMarkupPercentLabel(12.5)).toBe('+12.5%')
    expect(formatMarkupPercentLabel(0)).toBe('0%')
    expect(formatMarkupPercentLabel(-4.2)).toBe('−4.2%')
  })
})
