import { describe, expect, it } from 'vitest'
import { parseAdminTextDate } from '@/lib/migration/admin-date-parse'
import {
  loadSystemCorrectRows,
  parseSystemCorrectRowActions,
  sortSystemCorrectActions,
  type SystemCorrectRow,
} from '@/lib/migration/system-correct-workbook'
import type { ResolvedProduct } from '@/lib/migration/admin-intake-corrections'

const product: ResolvedProduct = {
  product_id: '00000000-0000-4000-8000-000000000001',
  product_name: 'TEST PRODUCT',
  barcode: '123',
  vendor_id: '00000000-0000-4000-8000-000000000002',
  vendor_name: 'NASMIN ENTERPRISE',
}

function row(partial: Partial<SystemCorrectRow> & Pick<SystemCorrectRow, 'rowNum'>): SystemCorrectRow {
  return {
    vendor_name: 'NASMIN ENTERPRISE',
    product_name: 'AUNTY LULUS GREEN CHILLI 200G',
    current_date: '',
    quantity: '',
    action: '',
    delivered_target: '',
    replace_date: '',
    not_in_system_date: '',
    reference: '',
    receiving_qty: '',
    current_qty: '',
    replace_qty: '',
    notes: '',
    barcode: '',
    ...partial,
  }
}

describe('parseAdminTextDate', () => {
  it('parses 13 DEC 2025', () => {
    expect(parseAdminTextDate('13 DEC 2025')).toBe('2025-12-13')
    expect(parseAdminTextDate('DATE SHOULD BE 13 DEC 2025')).toBe('2025-12-13')
  })
})

describe('parseSystemCorrectRowActions', () => {
  it('parses ADD 1 TO MAKE 32', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 2,
        current_date: '2025-05-02',
        quantity: '31',
        action: 'ADD 1 TO MAKE 32',
      }),
      product
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'update_qty', fromQty: 31, toQty: 32, onDate: '2025-05-02' })
  })

  it('parses delivered column target', () => {
    const actions = parseSystemCorrectRowActions(
      row({ rowNum: 3, current_date: '2025-05-02', delivered_target: '64' }),
      product
    )
    expect(actions[0]).toMatchObject({ kind: 'delivery_target', deliveredTotal: 64 })
  })

  it('parses CHANGE TO with date phrase', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 11,
        current_date: '2025-03-18',
        quantity: '31',
        action: 'CHANGE TO 32 AND DATE SHOULD BE 13 DEC 2025',
      }),
      product
    )
    expect(actions[0]).toMatchObject({
      kind: 'update_date',
      fromDate: '2025-03-18',
      toDate: '2025-12-13',
      toQty: 32,
    })
  })

  it('sorts delivery targets after intake fixes', () => {
    const sorted = sortSystemCorrectActions([
      { kind: 'delivery_target', sourceRows: [3], product, deliveredTotal: 64, notes: '' },
      { kind: 'update_qty', sourceRows: [2], product, fromQty: 31, toQty: 32, onDate: '2025-05-02' },
    ])
    expect(sorted[0].kind).toBe('update_qty')
    expect(sorted[1].kind).toBe('delivery_target')
  })
})

describe('loadSystemCorrectRows batch 4 layout', () => {
  it('reads DELEVERED column from local workbook when present', async () => {
    const rows = await loadSystemCorrectRows('discrepancies fix/SYSTEM CORRECT FARMER TORKS 4.xlsx')
    expect(rows.length).toBeGreaterThan(10)
    const deliveryOnly = rows.find((r) => r.rowNum === 3)
    expect(deliveryOnly?.delivered_target).toBe('64')
    expect(rows.find((r) => r.rowNum === 2)?.action).toMatch(/ADD 1 TO MAKE 32/i)
  })
})
