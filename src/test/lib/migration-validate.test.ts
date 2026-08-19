import { describe, expect, it } from 'vitest'
import { validateRow } from '@/lib/migration/validate'
import { normalizeSalesRowData } from '@/lib/migration/sales-fields'

describe('validateRow — date accuracy (never silently default a historical date to "today")', () => {
  it('intakes: missing received_date is a hard error, not a silent default', () => {
    const { errors } = validateRow('intakes', {
      vendor_name: 'Acme Foods',
      product_name: 'Palm Oil 1L',
      quantity: 10,
    })
    expect(errors.some((e) => e.code === 'MISSING_DATE')).toBe(true)
  })

  it('intakes: unparseable received_date is a hard error', () => {
    const { errors } = validateRow('intakes', {
      vendor_name: 'Acme Foods',
      product_name: 'Palm Oil 1L',
      quantity: 10,
      received_date: 'not-a-date',
    })
    expect(errors.some((e) => e.code === 'INVALID_DATE')).toBe(true)
  })

  it('intakes: a valid received_date passes clean', () => {
    const { errors } = validateRow('intakes', {
      vendor_name: 'Acme Foods',
      product_name: 'Palm Oil 1L',
      quantity: 10,
      received_date: '2024-01-15',
    })
    expect(errors).toEqual([])
  })

  it('deliveries: missing delivery_date is a hard error', () => {
    const { errors } = validateRow('deliveries', {
      product_name: 'Palm Oil 1L',
      quantity: 5,
    })
    expect(errors.some((e) => e.code === 'MISSING_DATE')).toBe(true)
  })

  it('returns: missing return_date is a hard error', () => {
    const { errors } = validateRow('returns', {
      product_name: 'Palm Oil 1L',
      quantity: 2,
      reason: 'defective_product',
    })
    expect(errors.some((e) => e.code === 'MISSING_DATE')).toBe(true)
  })

  it('deductions: missing deduction_date is a hard error', () => {
    const { errors } = validateRow('deductions', {
      vendor_name: 'Acme Foods',
      amount: 50,
    })
    expect(errors.some((e) => e.code === 'MISSING_DATE')).toBe(true)
  })

  it('payouts: missing payout_date and week_start is a hard error', () => {
    const { errors } = validateRow('payouts', {
      vendor_name: 'Acme Foods',
      amount_paid: 100,
    })
    expect(errors.some((e) => e.code === 'MISSING_DATE')).toBe(true)
  })

  it('payouts: week_start alone (no payout_date) satisfies the date requirement', () => {
    const { errors } = validateRow('payouts', {
      vendor_name: 'Acme Foods',
      amount_paid: 100,
      week_start: '2024-01-01',
    })
    expect(errors.some((e) => e.code === 'MISSING_DATE' || e.code === 'INVALID_DATE')).toBe(false)
  })
})

describe('validateRow — sales are always reported by full calendar month', () => {
  it('missing week_start and report_month is a hard error', () => {
    const { errors } = validateRow('sales', { product: 'Palm Oil 1L', qty: 5 })
    expect(errors.some((e) => e.code === 'MISSING_DATE')).toBe(true)
  })

  it('missing TCostEx is a hard error', () => {
    const { errors } = validateRow('sales', {
      product: 'Palm Oil 1L',
      qty: 5,
      report_month: '2024-03-01',
    })
    expect(errors.some((e) => e.code === 'MISSING_TCOST')).toBe(true)
  })

  it('a mid-month week_start is snapped to full calendar month bounds', () => {
    const { normalized } = validateRow('sales', {
      product: 'Palm Oil 1L',
      qty: 5,
      TCostEx: 150,
      week_start: '2024-03-15',
    })
    expect(normalized.week_start).toBe('2024-03-01')
    expect(normalized.week_end).toBe('2024-03-31')
  })

  it('report_month alone (no week_start) resolves to that month\'s full bounds', () => {
    const { normalized, errors } = validateRow('sales', {
      product: 'Palm Oil 1L',
      qty: 5,
      TCostEx: 150,
      report_month: '2024-02',
    })
    expect(errors).toEqual([])
    expect(normalized.week_start).toBe('2024-02-01')
    expect(normalized.week_end).toBe('2024-02-29') // 2024 is a leap year
  })

  it('flags when the source-provided week_end disagrees with the calendar month it gets snapped to', () => {
    const { warnings } = validateRow('sales', {
      product: 'Palm Oil 1L',
      qty: 5,
      TCostEx: 150,
      week_start: '2024-03-01',
      week_end: '2024-03-15', // half a month, not the full month — a real misalignment
    })
    expect(warnings.some((w) => w.code === 'SALES_PERIOD_ADJUSTED')).toBe(true)
  })

  it('does not flag when week_end already matches the full calendar month', () => {
    const { warnings } = validateRow('sales', {
      product: 'Palm Oil 1L',
      qty: 5,
      TCostEx: 150,
      week_start: '2024-03-01',
      week_end: '2024-03-31',
    })
    expect(warnings.some((w) => w.code === 'SALES_PERIOD_ADJUSTED')).toBe(false)
  })

  it('Palace MONTH + report_year normalizes to full calendar month via normalizeSalesRowData', () => {
    const { errors, normalized } = validateRow(
      'sales',
      normalizeSalesRowData({
        description: 'Palm Oil 1L',
        code: '1234567890',
        qty: 5,
        store_name: 'LABONE',
        TCostEx: 150,
        MONTH: 'JUNE',
        report_year: 2024,
      })
    )
    expect(errors.filter((e) => e.code === 'MISSING_DATE' || e.code === 'INVALID_DATE')).toEqual([])
    expect(normalized.week_start).toBe('2024-06-01')
    expect(normalized.week_end).toBe('2024-06-30')
    expect(normalized.vendor_due).toBe(150)
  })
})
