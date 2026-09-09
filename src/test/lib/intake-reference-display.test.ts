/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  getWarehouseStockDiscrepancy,
  intakeRowHasDiscrepancyHint,
  parseIntakeReference,
} from '@/lib/intake-reference-display'

describe('parseIntakeReference', () => {
  it('maps migration references to migration badge', () => {
    const badge = parseIntakeReference('migration:c99c684d-69c0-4231-8e8b-c76d7d7f5994')
    expect(badge?.label).toBe('Migration')
    expect(badge?.tone).toBe('migration')
    expect(badge?.isSystemOverride).toBe(true)
  })

  it('maps admin stock correction references', () => {
    const badge = parseIntakeReference('admin-correction:stock-chain')
    expect(badge?.label).toBe('Stock fix')
    expect(badge?.tone).toBe('correction')
  })

  it('treats manual PO references as non-system', () => {
    const badge = parseIntakeReference('PO-4421')
    expect(badge?.tone).toBe('manual')
    expect(badge?.isSystemOverride).toBe(false)
  })

  it('returns null for empty reference', () => {
    expect(parseIntakeReference(null)).toBeNull()
    expect(parseIntakeReference('  ')).toBeNull()
  })
})

describe('getWarehouseStockDiscrepancy', () => {
  it('flags delivery without intake', () => {
    const d = getWarehouseStockDiscrepancy(0, 12)
    expect(d?.kind).toBe('delivery_without_intake')
  })

  it('flags over-delivered warehouse', () => {
    const d = getWarehouseStockDiscrepancy(10, 25)
    expect(d?.kind).toBe('over_delivered')
  })

  it('returns null when balanced', () => {
    expect(getWarehouseStockDiscrepancy(160, 160)).toBeNull()
  })
})

describe('intakeRowHasDiscrepancyHint', () => {
  it('is true for system override references', () => {
    expect(intakeRowHasDiscrepancyHint('admin-correction:stock-chain', null)).toBe(true)
  })

  it('is true for stock discrepancy even on manual reference', () => {
    expect(intakeRowHasDiscrepancyHint('PO-1', getWarehouseStockDiscrepancy(0, 5))).toBe(true)
  })
})
