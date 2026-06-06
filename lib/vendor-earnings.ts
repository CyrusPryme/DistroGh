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

/** SQL balance: sales vendor_due − returns at vendor_price − optional deductions − completed payouts. */
export function vendorBalanceSql(includeDeductions: boolean): string {
  const deduct = includeDeductions
    ? `(select total_deductions from deductions_totals)`
    : '0'
  return `
    with sales_totals as (
      select coalesce(sum(s.vendor_due), 0) as total_due
      from public.sales s
      join public.products pr on pr.id = s.product_id
      where s.deleted_at is null and pr.deleted_at is null and pr.vendor_id = $1::uuid
    ),
    returns_totals as (
      select coalesce(sum(r.quantity_returned * pr.vendor_price), 0) as returns_deduct
      from public.product_returns r
      join public.products pr on pr.id = r.product_id
      where r.deleted_at is null and pr.deleted_at is null and pr.vendor_id = $1::uuid
    ),
    deductions_totals as (
      select coalesce(sum(amount), 0) as total_deductions
      from public.vendor_deductions where vendor_id = $1::uuid
    ),
    paid_totals as (
      select coalesce(sum(amount_paid), 0) as total_paid
      from public.payouts
      where vendor_id = $1::uuid and deleted_at is null and status = 'completed'
    )
    select
      (select total_due from sales_totals)
      - (select returns_deduct from returns_totals)
      - ${deduct}
      - (select total_paid from paid_totals)
      as balance
  `
}
