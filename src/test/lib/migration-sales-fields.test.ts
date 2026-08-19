import { describe, expect, it } from 'vitest'
import {
  isSupermarketPaidMarker,
  monthTextToReportMonth,
  normalizeSalesRowData,
  parseMonthName,
  rowHasPaidColumn,
} from '@/lib/migration/sales-fields'

describe('sales-fields — Palace column normalization', () => {
  it('maps store_name, MONTH+report_year, PAYMENT TO SUPPLIER, and PAID → supermarket_paid', () => {
    const out = normalizeSalesRowData({
      store: 1020,
      store_name: 'LABONE',
      Code: '342787011143',
      description: 'TROPICA WATERMELON SUGARDRAGON',
      Qty: 1,
      'PAYMENT TO SUPPLIER': 35,
      MONTH: 'JUNE',
      report_year: 2024,
      PAID: 'PAID',
    })
    expect(out.branch).toBe('LABONE')
    expect(out.code).toBe('342787011143')
    expect(out.report_month).toBe('2024-06-01')
    expect(out.vendor_due).toBe(35)
    expect(out.supermarket_paid).toBe(true)
  })

  it('blank PAID = supermarket has not paid DistroGH yet', () => {
    const out = normalizeSalesRowData({ PAID: null, MONTH: 'MAY', report_year: 2024, qty: 1 })
    expect(out.supermarket_paid).toBe(false)
    expect(out.report_month).toBe('2024-05-01')
  })

  it('no PAID column leaves supermarket_paid unset', () => {
    const out = normalizeSalesRowData({ description: 'Oil', qty: 1, report_month: '2024-01-01' })
    expect(out.supermarket_paid).toBeUndefined()
    expect(rowHasPaidColumn({ description: 'Oil' })).toBe(false)
  })

  it('parseMonthName handles full month names', () => {
    expect(parseMonthName('JUNE')).toBe(6)
    expect(parseMonthName('December')).toBe(12)
    expect(parseMonthName('nope')).toBeNull()
  })

  it('monthTextToReportMonth builds YYYY-MM-01', () => {
    expect(monthTextToReportMonth('APRIL', 2023)).toBe('2023-04-01')
    expect(monthTextToReportMonth('APRIL', null)).toBeNull()
  })

  it('isSupermarketPaidMarker: non-blank PAID means settled', () => {
    expect(isSupermarketPaidMarker('PAID')).toBe(true)
    expect(isSupermarketPaidMarker('')).toBe(false)
    expect(isSupermarketPaidMarker(null)).toBe(false)
  })

  it('supermarket_paid Yes/No column from historical template', () => {
    expect(normalizeSalesRowData({ supermarket_paid: 'Yes' }).supermarket_paid).toBe(true)
    expect(normalizeSalesRowData({ supermarket_paid: 'No' }).supermarket_paid).toBe(false)
  })

  it('aggregated rows keep per-row TCostEx — not derived from catalog', () => {
    const jan = normalizeSalesRowData({
      description: 'Juice',
      code: '111',
      qty: 2,
      TCostEx: 20,
      report_month: '2024-01-01',
    })
    const jul = normalizeSalesRowData({
      description: 'Juice',
      code: '111',
      qty: 2,
      TCostEx: 30,
      report_month: '2024-07-01',
    })
    expect(jan.vendor_due).toBe(20)
    expect(jul.vendor_due).toBe(30)
  })

  it('derives total_sales and commission from row unit_price when shop total is present', () => {
    const out = normalizeSalesRowData({
      qty: 10,
      TCostEx: 40,
      unit_price: 5,
      report_month: '2024-03-01',
    })
    expect(out.vendor_due).toBe(40)
    expect(out.total_sales).toBe(50)
    expect(out.commission_amount).toBe(10)
  })
})
