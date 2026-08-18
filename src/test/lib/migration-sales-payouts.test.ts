import { describe, expect, it } from 'vitest'
import {
  aggregateSalesPayoutGroups,
  shouldGenerateSalesPayouts,
  salesPayoutsAlreadyGenerated,
} from '@/lib/migration/sales-payouts'
import { isPaidMarker } from '@/lib/migration/sales-fields'

describe('sales-payouts — PAID flag semantics', () => {
  it('blank PAID means unpaid, any value means paid', () => {
    expect(isPaidMarker(null)).toBe(false)
    expect(isPaidMarker('')).toBe(false)
    expect(isPaidMarker('PAID')).toBe(true)
    expect(isPaidMarker(304)).toBe(true)
  })
})

describe('sales-payouts — aggregation', () => {
  it('groups rows by vendor + month and sums vendor_due', async () => {
    const vendorId = '11111111-1111-1111-1111-111111111111'
    const productId = '22222222-2222-2222-2222-222222222222'
    const migrationId = '33333333-3333-3333-3333-333333333333'

    const stagingRows = [
      {
        raw_data: { description: 'A', PAID: 'PAID', MONTH: 'JUNE', report_year: 2024 },
        corrections: {},
        normalized_data: { week_start: '2024-06-01', week_end: '2024-06-30', vendor_due: 100 },
        resolved_refs: { product_id: productId, vendor_id: vendorId },
      },
      {
        raw_data: { description: 'B', PAID: null, MONTH: 'JUNE', report_year: 2024 },
        corrections: {},
        normalized_data: { week_start: '2024-06-01', week_end: '2024-06-30', vendor_due: 50 },
        resolved_refs: { product_id: productId, vendor_id: vendorId },
      },
      {
        raw_data: { description: 'C', PAID: null, MONTH: 'MAY', report_year: 2024 },
        corrections: {},
        normalized_data: { week_start: '2024-05-01', week_end: '2024-05-31', vendor_due: 75 },
        resolved_refs: { product_id: productId, vendor_id: vendorId },
      },
    ]

    const pool = {
      query: async (sql: string) => {
        if (sql.includes('migration_staging_rows')) {
          return { rows: stagingRows }
        }
        if (sql.includes('products')) {
          return { rows: [{ id: productId, vendor_id: vendorId }] }
        }
        return { rows: [] }
      },
    }

    const { groups, skippedRows } = await aggregateSalesPayoutGroups(pool as never, migrationId)
    expect(skippedRows).toBe(0)
    expect(groups).toHaveLength(2)

    const june = groups.find((g) => g.weekStart === '2024-06-01')
    expect(june?.amountDue).toBe(150)
    expect(june?.vendorPaid).toBe(true)
    expect(june?.saleRowCount).toBe(2)

    const may = groups.find((g) => g.weekStart === '2024-05-01')
    expect(may?.amountDue).toBe(75)
    expect(may?.vendorPaid).toBe(false)
  })

  it('shouldGenerateSalesPayouts skips when explicit payouts file exists', async () => {
    const migrationId = '33333333-3333-3333-3333-333333333333'
    const pool = {
      query: async (sql: string) => {
        if (sql.includes("entity_type = 'sales'")) return { rows: [{ x: 1 }] }
        if (sql.includes("entity_type = 'payouts'") && sql.includes('intended_action')) {
          return { rows: [{ x: 1 }] }
        }
        if (sql.includes('sales_paid_flags')) return { rows: [] }
        return { rows: [] }
      },
    }
    expect(await shouldGenerateSalesPayouts(pool as never, migrationId)).toBe(false)
  })

  it('salesPayoutsAlreadyGenerated detects prior run', async () => {
    const pool = {
      query: async () => ({ rows: [{ x: 1 }] }),
    }
    expect(await salesPayoutsAlreadyGenerated(pool as never, 'any')).toBe(true)
  })
})
