/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  assertSupermarketTotalNotStoredAsVendorDue,
  computeImportSaleAmounts,
} from '@/lib/product-pricing'

describe('Palace / supermarket TCostEx is DistroGH shop total', () => {
  it('splits supermarket line total into vendor due + Distro markup', () => {
    const split = computeImportSaleAmounts(5, 30, 20, 150)
    expect(split.total_sales).toBe(150)
    expect(split.vendor_due).toBe(100)
    expect(split.commission_amount).toBe(50)
  })

  it('refuses to save Distro shop total as vendor due when Palace TCostEx matches catalog shop price', () => {
    expect(() =>
      assertSupermarketTotalNotStoredAsVendorDue({
        totalSales: 150,
        vendorDue: 150,
        catalogMarkup: 10,
        catalogShopTotal: 150,
      })
    ).toThrow(/shop total, not vendor due/)
  })

  it('allows vendor due to equal TCostEx when Palace charged vendor cost only', () => {
    expect(() =>
      assertSupermarketTotalNotStoredAsVendorDue({
        totalSales: 100,
        vendorDue: 100,
        catalogMarkup: 10,
        catalogShopTotal: 150,
      })
    ).not.toThrow()
  })

  it('allows vendor due to equal shop total when the product has no markup', () => {
    expect(() =>
      assertSupermarketTotalNotStoredAsVendorDue({
        totalSales: 150,
        vendorDue: 150,
        catalogMarkup: 0,
      })
    ).not.toThrow()
  })
})
