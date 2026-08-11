import { describe, expect, it } from 'vitest'
import { computeFinancialIntegrityChecks } from '@/lib/migration/financial-integrity'
import { createMockClient } from './mock-pg-client'

describe('computeFinancialIntegrityChecks — financial integrity flagged before commit', () => {
  it('flags a sales line whose qty * unit_price does not match total_sales', async () => {
    const client = createMockClient([
      {
        match: /entity_type = 'sales'/,
        respond: () => ({
          rows: [
            {
              id: 'row-1',
              row_number: 5,
              file_id: 'file-1',
              normalized_data: { qty: 10, unit_price: 5, total_sales: 100 }, // expected 50, got 100
              corrections: {},
            },
          ],
        }),
      },
      { match: /entity_type = 'payouts'/, respond: () => ({ rows: [] }) },
      { match: /entity_type = 'returns'/, respond: () => ({ rows: [{ c: 0 }] }) },
    ])
    const discrepancies = await computeFinancialIntegrityChecks(client, 'MIG-1')
    const lineMismatch = discrepancies.find((d) => d.category === 'line_total_mismatch')
    expect(lineMismatch).toBeDefined()
    expect(lineMismatch?.expected_value).toBe(50)
    expect(lineMismatch?.actual_value).toBe(100)
    expect(lineMismatch?.severity).toBe('error') // >10% off is an error, not just a warning
  })

  it('does not flag sales rows whose arithmetic is internally consistent', async () => {
    const client = createMockClient([
      {
        match: /entity_type = 'sales'/,
        respond: () => ({
          rows: [
            {
              id: 'row-1',
              row_number: 5,
              file_id: 'file-1',
              normalized_data: { qty: 10, unit_price: 5, total_sales: 50, vendor_due: 40, commission_amount: 10 },
              corrections: {},
            },
          ],
        }),
      },
      { match: /entity_type = 'payouts'/, respond: () => ({ rows: [] }) },
      { match: /entity_type = 'returns'/, respond: () => ({ rows: [{ c: 0 }] }) },
    ])
    const discrepancies = await computeFinancialIntegrityChecks(client, 'MIG-1')
    expect(discrepancies.some((d) => d.category === 'line_total_mismatch')).toBe(false)
    expect(discrepancies.some((d) => d.category === 'vendor_due_plus_commission_mismatch')).toBe(false)
    const totalInfo = discrepancies.find((d) => d.category === 'expected_sales_total')
    expect(totalInfo?.severity).toBe('info')
  })

  it('flags a payout whose amount_paid does not match amount_due', async () => {
    const client = createMockClient([
      { match: /entity_type = 'sales'/, respond: () => ({ rows: [] }) },
      {
        match: /entity_type = 'payouts'/,
        respond: () => ({
          rows: [{ id: 'p1', row_number: 3, file_id: 'file-1', normalized_data: { amount_paid: 80, amount_due: 100 }, corrections: {} }],
        }),
      },
      { match: /entity_type = 'returns'/, respond: () => ({ rows: [{ c: 0 }] }) },
    ])
    const discrepancies = await computeFinancialIntegrityChecks(client, 'MIG-1')
    const payoutMismatch = discrepancies.find((d) => d.category === 'amount_paid_vs_due_mismatch')
    expect(payoutMismatch).toBeDefined()
    expect(payoutMismatch?.difference).toBe(-20)
    expect(payoutMismatch?.severity).toBe('warning')
  })
})
