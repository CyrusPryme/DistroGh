import { describe, expect, it } from 'vitest'
import { effectiveReturnDeduction } from '@/lib/vendor-return-balance'
import { vendorBalanceSql } from '@/lib/vendor-balance-sql'

describe('effectiveReturnDeduction', () => {
  it('caps return value at settled vendor due for the pair', () => {
    expect(effectiveReturnDeduction(500, 100)).toBe(100)
    expect(effectiveReturnDeduction(50, 100)).toBe(50)
    expect(effectiveReturnDeduction(50, 0)).toBe(0)
  })
})

describe('vendorBalanceSql settled returns cap', () => {
  it('joins returns to settled sales by product and supermarket', () => {
    const sql = vendorBalanceSql(true)
    expect(sql).toContain('settled_by_pair')
    expect(sql).toContain('returns_by_pair')
    expect(sql).toContain('least(')
    expect(sql).toContain('supermarket_paid = true')
  })
})
