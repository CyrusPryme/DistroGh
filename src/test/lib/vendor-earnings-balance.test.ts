import { describe, expect, it } from 'vitest'
import { vendorBalanceSql } from '@/lib/vendor-balance-sql'

describe('vendorBalanceSql', () => {
  it('counts non-failed payout amounts (including partial pending), not completed-only', () => {
    const sql = vendorBalanceSql(true)
    expect(sql).toContain("status <> 'failed'")
    expect(sql).not.toMatch(/status\s*=\s*'completed'/)
  })

  it('uses return row unit_price with catalog fallback', () => {
    const sql = vendorBalanceSql(false)
    expect(sql).toContain('r.unit_price')
    expect(sql).toContain('pr.vendor_price')
  })

  it('only includes supermarket-settled sales', () => {
    const sql = vendorBalanceSql(true)
    expect(sql).toContain('supermarket_paid = true')
  })

  it('caps returns by settled sales at each product and supermarket', () => {
    const sql = vendorBalanceSql(true)
    expect(sql).toContain('least(')
    expect(sql).toContain('settled_by_pair')
  })
})
