import { describe, expect, it } from 'vitest'
import {
  validateLiveTransportCost,
  resolveHistoricalTransportCost,
  formatTransportCostForDisplay,
} from '@/lib/migration/transport-cost'

describe('resolveHistoricalTransportCost — historical migration context', () => {
  it('Scenario 3 — historical delivery with transport cost → imports the exact value', () => {
    expect(resolveHistoricalTransportCost(125.5)).toBe(125.5)
    expect(resolveHistoricalTransportCost('125.50')).toBe(125.5)
    expect(resolveHistoricalTransportCost(0)).toBe(0) // 0 is a real recorded cost, not "missing"
  })

  it('Scenario 4 — historical delivery without transport cost → preserves NULL, never invents a value', () => {
    expect(resolveHistoricalTransportCost(null)).toBeNull()
    expect(resolveHistoricalTransportCost(undefined)).toBeNull()
    expect(resolveHistoricalTransportCost('')).toBeNull()
  })

  it('never coerces unparsable input into 0', () => {
    expect(resolveHistoricalTransportCost('N/A')).toBeNull()
    expect(resolveHistoricalTransportCost('Unknown')).toBeNull()
  })
})

describe('validateLiveTransportCost — live operation context', () => {
  it('Scenario 5 — new live delivery with transport cost → accepted', () => {
    expect(validateLiveTransportCost(50)).toEqual({ ok: true, value: 50 })
    expect(validateLiveTransportCost('50')).toEqual({ ok: true, value: 50 })
    expect(validateLiveTransportCost(0)).toEqual({ ok: true, value: 0 }) // 0 is valid, distinct from "not provided"
  })

  it('Scenario 6 — new live delivery without transport cost → MUST FAIL (null/empty/undefined)', () => {
    expect(validateLiveTransportCost(null).ok).toBe(false)
    expect(validateLiveTransportCost(undefined).ok).toBe(false)
    expect(validateLiveTransportCost('').ok).toBe(false)
  })

  it('rejects non-numeric and negative values', () => {
    expect(validateLiveTransportCost('not-a-number').ok).toBe(false)
    expect(validateLiveTransportCost(-5).ok).toBe(false)
  })

  it('never relaxes for historical-shaped input — the live validator has no NULL-allowed path', () => {
    // Even though HISTORICAL_MIGRATION allows NULL, the live validator function itself
    // has no parameter/branch that permits it — this is enforced by type signature, not
    // a runtime flag that could be toggled off by mistake.
    const result = validateLiveTransportCost(null)
    expect(result).toEqual({ ok: false, error: 'total_transport_cost is required for new deliveries' })
  })
})

describe('formatTransportCostForDisplay', () => {
  it('shows "Not Recorded (Historical)" for NULL historical transport cost', () => {
    expect(formatTransportCostForDisplay(null, 'HISTORICAL_MIGRATION')).toBe('Not Recorded (Historical)')
  })

  it('shows the exact recorded value when present', () => {
    expect(formatTransportCostForDisplay(125.5, 'HISTORICAL_MIGRATION')).toBe('125.50')
    expect(formatTransportCostForDisplay(0, 'HISTORICAL_MIGRATION')).toBe('0.00')
  })

  it('never renders a historical-style label for a live NULL — that state should not occur, but display must not lie', () => {
    expect(formatTransportCostForDisplay(null, 'LIVE_OPERATION')).toBe('Missing')
  })
})
