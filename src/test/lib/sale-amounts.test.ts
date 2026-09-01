/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getSaleMarkupAmount, getSaleRecordedAmounts, sqlEffectiveDistroMarkup } from '@/lib/sale-amounts'
import type { Sale } from '@/types'

describe('getSaleMarkupAmount', () => {
  it('uses stored commission when it was recorded on import', () => {
    expect(
      getSaleMarkupAmount({
        qty_sold: 10,
        commission_amount: 25,
        product: { distrogh_markup: 99 },
      })
    ).toBe(25)
  })

  it('falls back to qty × product distrogh_markup when commission was stored as 0', () => {
    expect(
      getSaleMarkupAmount({
        qty_sold: 4,
        commission_amount: 0,
        product: { distrogh_markup: 2.5, vendor_price: 10 },
      })
    ).toBe(10)
  })

  it('stays 0 when the product has no markup', () => {
    expect(
      getSaleMarkupAmount({
        qty_sold: 8,
        commission_amount: 0,
        product: { distrogh_markup: 0, vendor_price: 12 },
      })
    ).toBe(0)
  })
})

describe('getSaleRecordedAmounts', () => {
  it('keeps imported vendor due and fills markup from the catalog', () => {
    const sale = {
      total_sales: 40,
      vendor_due: 40,
      commission_amount: 0,
      qty_sold: 2,
      product: { distrogh_markup: 3, vendor_price: 20 },
    } as Sale
    expect(getSaleRecordedAmounts(sale)).toEqual({
      totalSales: 40,
      vendorDue: 40,
      markupAmount: 6,
    })
  })
})

describe('sqlEffectiveDistroMarkup', () => {
  it('joins stored commission with catalog markup', () => {
    const sql = sqlEffectiveDistroMarkup('s', 'p')
    expect(sql).toContain('s.commission_amount')
    expect(sql).toContain('p.distrogh_markup')
    expect(sql).toContain('s.qty_sold')
  })
})
