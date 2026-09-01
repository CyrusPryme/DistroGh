import type { Sale } from '@/types'
import type { ProductPricingFields } from '@/lib/product-pricing'
import { resolveProductPricing } from '@/lib/product-pricing'
import { roundMoney } from '@/lib/utils'

export type SaleMarkupFields = {
  qty_sold?: number | null
  commission_amount?: number | null
  product?: ProductPricingFields | null
}

/** Per-unit DistroGH markup from the product catalog (markup + shop add-ons). */
export function catalogUnitMarkup(product: ProductPricingFields | null | undefined): number {
  const pricing = resolveProductPricing(product)
  return roundMoney(pricing.markup + pricing.addOnTotal)
}

/**
 * DistroGH markup for a sale line.
 * Uses the amount snapshotted on import when present; otherwise qty × catalog
 * `distrogh_markup` (historical Palace rows stored commission as 0).
 */
export function getSaleMarkupAmount(sale: SaleMarkupFields): number {
  const stored = roundMoney(Number(sale.commission_amount ?? 0))
  if (stored > 0) return stored
  const qty = Number(sale.qty_sold ?? 0)
  if (qty <= 0) return 0
  return roundMoney(qty * catalogUnitMarkup(sale.product))
}

/**
 * SQL expression: stored commission, else qty × product.distrogh_markup.
 * Requires `sales` and `products` already joined.
 */
export function sqlEffectiveDistroMarkup(salesAlias = 's', productsAlias = 'p'): string {
  return `CASE
    WHEN COALESCE(${salesAlias}.commission_amount, 0) > 0 THEN ${salesAlias}.commission_amount
    ELSE ROUND((${salesAlias}.qty_sold * COALESCE(${productsAlias}.distrogh_markup, 0))::numeric, 2)
  END`
}

/** Amounts for admin sales displays. Vendor due stays the imported snapshot. */
export function getSaleRecordedAmounts(sale: Sale): {
  totalSales: number
  vendorDue: number
  markupAmount: number
} {
  return {
    totalSales: roundMoney(Number(sale.total_sales ?? 0)),
    vendorDue: roundMoney(Number(sale.vendor_due ?? 0)),
    markupAmount: getSaleMarkupAmount(sale),
  }
}

/** Shop unit price stored on the sale when it was imported. */
export function getSaleShopUnitPrice(sale: Sale): number {
  return roundMoney(Number(sale.unit_price ?? 0))
}

/** Vendor unit price implied by the imported sale (vendor_due ÷ qty). */
export function getSaleVendorUnitPrice(sale: Sale): number {
  const qty = Number(sale.qty_sold ?? 0)
  if (qty <= 0) return 0
  return roundMoney(Number(sale.vendor_due ?? 0) / qty)
}

/** Line total owed to vendor from the imported sale snapshot. */
export function getVendorLineTotal(sale: Sale): number {
  return getSaleRecordedAmounts(sale).vendorDue
}
