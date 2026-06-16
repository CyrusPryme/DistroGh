import { describe, it, expect } from 'vitest'
import {
  allocateTransportCostByQuantity,
  sumAllocationAmounts,
  validateDeliveryChargeAllocation,
} from '@/lib/delivery-cost-allocation'
import { toSqlDate } from '@/lib/utils'

describe('delivery-cost-allocation', () => {
  it('splits transport cost by quantity', () => {
    const rows = allocateTransportCostByQuantity(100, [
      { vendor_id: 'a', vendor_name: 'A', quantity_delivered: 60 },
      { vendor_id: 'b', vendor_name: 'B', quantity_delivered: 40 },
    ])
    expect(rows).toHaveLength(2)
    expect(sumAllocationAmounts(rows)).toBe(100)
    expect(rows.find((r) => r.vendor_id === 'a')?.allocated_amount).toBe(60)
    expect(rows.find((r) => r.vendor_id === 'b')?.allocated_amount).toBe(40)
  })

  it('rejects charges when transport cost is zero', () => {
    expect(() =>
      validateDeliveryChargeAllocation(
        0,
        [{ vendor_id: 'a', quantity_delivered: 1, share_percent: 100, allocated_amount: 10 }],
        new Set(['a'])
      )
    ).toThrow(/not allowed when transport cost is zero/)
  })

  it('requires allocation when transport cost is positive', () => {
    expect(() => validateDeliveryChargeAllocation(50, [], new Set(['a']))).toThrow(
      /Transport cost is set/
    )
  })
})

describe('toSqlDate', () => {
  it('formats pg-style date strings', () => {
    expect(toSqlDate('2026-06-15')).toBe('2026-06-15')
    expect(toSqlDate('2026-06-15T00:00:00.000Z')).toBe('2026-06-15')
  })

  it('formats Date objects without locale strings', () => {
    const d = new Date('2026-06-15T00:00:00.000Z')
    expect(toSqlDate(d)).toBe('2026-06-15')
    expect(toSqlDate(d)).not.toMatch(/GMT/)
  })
})
