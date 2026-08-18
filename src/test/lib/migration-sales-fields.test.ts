import { describe, expect, it } from 'vitest'
import {
  isPaidMarker,
  monthTextToReportMonth,
  normalizeSalesRowData,
  parseMonthName,
} from '@/lib/migration/sales-fields'

describe('sales-fields — Palace column normalization', () => {
  it('maps store_name, MONTH+report_year, and PAYMENT TO SUPPLIER', () => {
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
    expect(out.vendor_paid).toBe(true)
  })

  it('treats blank PAID as unpaid', () => {
    const out = normalizeSalesRowData({ PAID: null, MONTH: 'MAY', report_year: 2024, qty: 1 })
    expect(out.vendor_paid).toBe(false)
    expect(out.report_month).toBe('2024-05-01')
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

  it('isPaidMarker: any non-blank PAID value means paid', () => {
    expect(isPaidMarker('PAID')).toBe(true)
    expect(isPaidMarker('Yes')).toBe(true)
    expect(isPaidMarker(304)).toBe(true)
    expect(isPaidMarker('')).toBe(false)
    expect(isPaidMarker(null)).toBe(false)
  })
})
