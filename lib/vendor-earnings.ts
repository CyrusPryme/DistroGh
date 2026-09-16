import type { Sale } from '@/types'
import { resolveProductPricing, type ProductPricingFields } from '@/lib/product-pricing'
import { getVendorLineTotal as getVendorLineTotalFromSale } from '@/lib/sale-amounts'

/** Agreed unit price on the product catalog (current pricing, not historical sales). */
export function getAgreedUnitPrice(product: ProductPricingFields | null | undefined): number {
  return resolveProductPricing(product).vendorPrice
}

/** Line total owed to vendor from the sale row recorded at import. */
export function getVendorLineTotal(sale: Sale): number {
  return getVendorLineTotalFromSale(sale)
}

export type VendorBalanceOptions = {
  /** When false, balance excludes vendor_deductions (vendor-facing view). Default true for admin. */
  includeDeductions?: boolean
}

export { vendorBalanceSql } from '@/lib/vendor-balance-sql'
