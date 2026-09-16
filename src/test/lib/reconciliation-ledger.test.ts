import { describe, expect, it } from 'vitest'
import { lifetimeVendorLedgerSumsSql } from '@/lib/reconciliation-ledger'

describe('lifetimeVendorLedgerSumsSql', () => {
  it('uses settled sales and capped returns consistent with vendor balance', () => {
    const sql = lifetimeVendorLedgerSumsSql(true)
    expect(sql).toContain('supermarket_paid = true')
    expect(sql).toContain('least(')
    expect(sql).toContain("status <> 'failed'")
    expect(sql).toContain('expected_balance_sum')
    expect(sql).toContain("v.status = 'active'")
  })
})
