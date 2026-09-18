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

  it('parses CHANGE QUANTITY 31 TO QUANTITY 32', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 2,
        current_date: '2025-05-02',
        quantity: '31',
        action: 'CHANGE QUANTITY 31 TO QUANTITY 32',
      }),
      product
    )
    expect(actions[0]).toMatchObject({
      kind: 'update_qty',
      fromQty: 31,
      toQty: 32,
      onDate: '2025-05-02',
    })
  })

  it('parses CHANGE QUANTITY 10 TO QUANTITY9 (no space before 9)', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 4,
        current_date: '2025-12-13',
        quantity: '10',
        action: 'CHANGE QUANTITY 10 TO QUANTITY9',
      }),
      product
    )
    expect(actions[0]).toMatchObject({ kind: 'update_qty', fromQty: 10, toQty: 9 })
  })

  it('parses DELETE QUANTITY OF 9', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 8,
        current_date: '2025-03-02',
        quantity: '9',
        action: 'DELETE QUANTITY OF 9',
      }),
      product
    )
    expect(actions[0]).toMatchObject({ kind: 'delete', onDate: '2025-03-02', matchQty: 9 })
  })

  it('parses CHANGE received 88 TO received 21', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 5,
        current_date: '2025-06-30',
        quantity: '88',
        action: 'CHANGE received 88 TO received 21',
      }),
      product
    )
    expect(actions[0]).toMatchObject({ kind: 'update_qty', fromQty: 88, toQty: 21, onDate: '2025-06-30' })
  })

  it('parses change delivered quantity 88 to delivered quantity 21', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 9,
        current_date: '2025-07-08',
        action: 'change delivered quantity 88 to delivered quantity 21',
      }),
      product
    )
    expect(actions[0]).toMatchObject({
      kind: 'update_delivery_qty',
      fromQty: 88,
      toQty: 21,
      onDate: '2025-07-08',
    })
  })

  it('parses DELETE receive 1 and delivered 1', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 11,
        current_date: '2025-06-02',
        quantity: '1',
        action: 'DELETE receive 1 and delivered 1',
      }),
      product
    )
    expect(actions[0]).toMatchObject({ kind: 'delete_receive_and_delivery', qty: 1, onDate: '2025-06-02' })
  })

  it('parses duplicate-date intake move to 13 DEC 2025', () => {
    const actions = parseSystemCorrectRowActions(
      row({
        rowNum: 7,
        current_date: '2025-05-02',
        quantity: '32',
        action:
          'THERE ARE 2 DATES STATED AS 5/2/2025 WITH QUANTITY OF 32 IN SYSTEM CHANGE ONE OF THE DATES TO BECOME 13 DEC 2025',
      }),
      product
    )
    expect(actions[0]).toMatchObject({
      kind: 'update_date',
      fromDate: '2025-05-02',
      toDate: '2025-12-13',
      matchQty: 32,
      limitMatches: 1,
    })
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

describe('loadSystemCorrectRows admin receiving/delivery layout', () => {
  it('reads ACTION TO BE TAKEN from local workbook when present', async () => {
    const path = 'discrepancies fix/receving and delivered corrcetion for nasmin.xlsx'
    const rows = await loadSystemCorrectRows(path)
    expect(rows.length).toBe(11)
    expect(rows.find((r) => r.rowNum === 5)?.action).toMatch(/CHANGE received 88 TO received 21/i)
    expect(rows.find((r) => r.rowNum === 9)?.action).toMatch(/delivered quantity 88/i)
  })
})
