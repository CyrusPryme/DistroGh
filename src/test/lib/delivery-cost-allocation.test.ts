import { describe, it, expect } from 'vitest'
import {
  allocateTransportCostByQuantity,
  sumAllocationAmounts,
  validateDeliveryChargeAllocation,
} from '@/lib/delivery-cost-allocation'
import { toSqlDate, parseFlexibleDate } from '@/lib/utils'

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

  // Real admin report: dates typed day-first (e.g. "15/01/2026", the convention used in Ghana
  // and most of the world outside the US) were rejected/misread regardless of how the parts were
  // reordered. Root cause: the native Date constructor (and Excel's own DATEVALUE()) assume
  // US-style month-first for ambiguous slash/dash text — day > 12 fails outright (no 15th
  // month), and day <= 12 is worse: it silently swaps day and month with no error at all.
  it('treats DD/MM/YYYY as day-first even when day > 12 (would be rejected under month-first parsing)', () => {
    expect(toSqlDate('15/01/2026')).toBe('2026-01-15')
  })

  it('treats DD-MM-YYYY (dash separator) as day-first too', () => {
    expect(toSqlDate('15-01-2026')).toBe('2026-01-15')
  })

  it('does not silently swap day/month for an ambiguous day <= 12 case (the dangerous silent-corruption case)', () => {
    // "03/04/2026" must resolve to 3 April 2026 (day-first), never 4 March 2026
    // (month-first) — the input is ambiguous to a human, but our parser has one fixed rule.
    expect(toSqlDate('03/04/2026')).toBe('2026-04-03')
  })

  it('rejects an out-of-range day-first date rather than letting it roll over to a different date', () => {
    // 32nd day of any month doesn't exist — must not silently roll into the next month.
    expect(parseFlexibleDate('32/01/2026')).toBeNull()
  })
})
