import { describe, expect, it } from 'vitest'
import {
  isSupermarketPaidMarker,
  monthTextToReportMonth,
  normalizeSalesRowData,
  parseMonthName,
  resolveHistoricalSaleAmounts,
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
    expect(out.total_sales).toBe(35)
    expect(out.unit_price).toBe(35)
    expect(out.vendor_due).toBeUndefined()
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

  it('paid Yes/No on template maps to supermarket_paid', () => {
    expect(normalizeSalesRowData({ paid: 'Yes' }).supermarket_paid).toBe(true)
    expect(normalizeSalesRowData({ paid: 'No' }).supermarket_paid).toBe(false)
  })

  it('legacy supermarket_paid column in uploads still maps via paid alias', () => {
    expect(normalizeSalesRowData({ supermarket_paid: 'Yes' }).supermarket_paid).toBe(true)
    expect(normalizeSalesRowData({ supermarket_paid: 'No' }).supermarket_paid).toBe(false)
  })

  it('keeps per-row TCostEx as DistroGH supermarket totals — not vendor due', () => {
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
    expect(jan.total_sales).toBe(20)
    expect(jul.total_sales).toBe(30)
    expect(jan.unit_price).toBe(10)
    expect(jul.unit_price).toBe(15)
    expect(jan.vendor_due).toBeUndefined()
    expect(jul.vendor_due).toBeUndefined()
  })

  it('ignores spreadsheet unit_price — derives shop unit from TCostEx ÷ qty only', () => {
    const out = normalizeSalesRowData({
      qty: 10,
      TCostEx: 40,
      unit_price: 99,
      report_month: '2024-03-01',
    })
    expect(out.total_sales).toBe(40)
    expect(out.unit_price).toBe(4)
    expect(out.vendor_due).toBeUndefined()
    expect(out.commission_amount).toBeUndefined()
  })

  it('splits TCostEx into vendor due + Distro markup when catalog vendor price is known', () => {
    const split = resolveHistoricalSaleAmounts(
      { qty: 5, TCostEx: 150 },
      { vendorPrice: 20 }
    )
    expect(split).toMatchObject({
      unit_price: 30,
      total_sales: 150,
      vendor_due: 100,
      commission_amount: 50,
      splitFromCatalog: true,
    })
  })
})
