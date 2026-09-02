/** Resolve vendor price, markup, and shop (supermarket) price from product fields. */

import { roundMoney } from '@/lib/utils'

export type ProductPricingFields = {
  vendor_price?: number | string | null
  distrogh_markup?: number | string | null
  selling_price?: number | string | null
  /** Optional public shelf price at supermarkets (manual; not used in payouts). */
  supermarket_selling_price?: number | string | null
}

/** Three catalog price tiers: vendor → distro (shop) → optional supermarket retail. */
export type ProductPriceTiers = {
  vendorPrice: number
  distroMarkup: number
  /** DistroGH price to supermarket = vendor + markup (+ add-ons). */
  distroPrice: number
  /** Public shelf price; null when not recorded. */
  supermarketSellingPrice: number | null
}

/** Optional future additive shop-price lines (logistics, packaging, etc.). */
export type ShopPriceAddOn = {
  key: string
  label: string
  getValue: (product: ProductPricingFields) => number
}

/**
 * Register extra per-unit amounts included in supermarket shop price.
 * Add entries here when new price components are introduced.
 */
export const SHOP_PRICE_ADD_ONS: ShopPriceAddOn[] = [
  // Example for a future migration:
  // { key: 'logistics_fee', label: 'Logistics', getValue: (p) => Number((p as Record<string, unknown>).logistics_fee ?? 0) },
]

function parseMoney(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function getShopPriceAddOnTotal(product: ProductPricingFields | null | undefined): number {
  if (!product) return 0
  return roundMoney(
    SHOP_PRICE_ADD_ONS.reduce((sum, addon) => {
      const v = addon.getValue(product)
      return sum + (Number.isFinite(v) ? v : 0)
    }, 0)
  )
}

/**
 * DistroGH unit price to supermarket = vendor price + DistroGH markup + registered add-ons.
 * Component sum is authoritative; selling_price is only a legacy fallback when components are empty.
 */
export function computeShopUnitPrice(product: ProductPricingFields | null | undefined): number {
  if (!product) return 0

  const markup = roundMoney(parseMoney(product.distrogh_markup))
  const addOnTotal = getShopPriceAddOnTotal(product)
  let vendorPrice = parseMoney(product.vendor_price)
  const selling = parseMoney(product.selling_price)

  if (vendorPrice <= 0 && selling > 0) {
    const inferred = roundMoney(selling - markup - addOnTotal)
    if (inferred > 0) vendorPrice = inferred
  }

  const fromComponents = roundMoney(vendorPrice + markup + addOnTotal)
  if (fromComponents > 0) return fromComponents

  if (selling > 0) return roundMoney(selling)
  return 0
}

export function resolveProductPricing(product: ProductPricingFields | null | undefined): {
  vendorPrice: number
  markup: number
  addOnTotal: number
  shopPrice: number
  vendorPriceInferred: boolean
} {
  if (!product) {
    return { vendorPrice: 0, markup: 0, addOnTotal: 0, shopPrice: 0, vendorPriceInferred: false }
  }

  const markup = roundMoney(parseMoney(product.distrogh_markup))
  const addOnTotal = getShopPriceAddOnTotal(product)
  const selling = parseMoney(product.selling_price)
  let vendorPrice = parseMoney(product.vendor_price)
  let vendorPriceInferred = false

  if (vendorPrice <= 0 && selling > 0) {
    const inferred = roundMoney(selling - markup - addOnTotal)
    if (inferred > 0) {
      vendorPrice = inferred
      vendorPriceInferred = true
    }
  }

  return {
    vendorPrice: roundMoney(vendorPrice),
    markup,
    addOnTotal,
    shopPrice: computeShopUnitPrice(product),
    vendorPriceInferred,
  }
}

export function parseOptionalUnitPrice(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = parseMoney(value)
  if (n <= 0 || Number.isNaN(n)) return null
  return roundMoney(n)
}

export function resolveProductPriceTiers(
  product: ProductPricingFields | null | undefined
): ProductPriceTiers {
  const pricing = resolveProductPricing(product)
  return {
    vendorPrice: pricing.vendorPrice,
    distroMarkup: roundMoney(pricing.markup + pricing.addOnTotal),
    distroPrice: pricing.shopPrice,
    supermarketSellingPrice: parseOptionalUnitPrice(product?.supermarket_selling_price),
  }
}

/** Markup % = (selling − cost) / cost × 100. Returns null when cost is missing or zero. */
export function computeMarkupPercent(
  sellingPrice: number | string | null | undefined,
  costPrice: number | string | null | undefined
): number | null {
  const selling = parseMoney(sellingPrice)
  const cost = parseMoney(costPrice)
  if (!Number.isFinite(selling) || !Number.isFinite(cost) || cost <= 0) return null
  return roundMoney(((selling - cost) / cost) * 100)
}

/** Human-readable markup label, e.g. +15% or 0%. */
export function formatMarkupPercentLabel(percent: number): string {
  const n = Number(percent)
  if (!Number.isFinite(n)) return '0%'
  const rounded = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Math.round(n * 10) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  const abs = Math.abs(rounded)
  const body = abs % 1 === 0 ? String(abs) : abs.toFixed(1).replace(/\.0$/, '')
  return `${sign}${body}%`
}

/** Adjust vendor/markup so shop price (vendor + markup + add-ons) matches a target. */
export function derivePricingForShopTarget(
  targetShop: number,
  current: ProductPricingFields
): { vendorPrice: number; distroghMarkup: number; shopPrice: number } {
  const target = roundMoney(targetShop)
  const markup = roundMoney(parseMoney(current.distrogh_markup))
  const addOnTotal = getShopPriceAddOnTotal(current)
  const fixedCharges = roundMoney(markup + addOnTotal)

  let vendorPrice: number
  let distroghMarkup = markup

  if (fixedCharges < target) {
    vendorPrice = roundMoney(target - fixedCharges)
  } else if (addOnTotal < target) {
    vendorPrice = roundMoney(target - addOnTotal)
    distroghMarkup = 0
  } else {
    vendorPrice = target
    distroghMarkup = 0
  }

  const shopPrice = roundMoney(vendorPrice + distroghMarkup + addOnTotal)
  return { vendorPrice, distroghMarkup, shopPrice }
}

/** When wholesale is omitted, it matches vendor (seller) price — no separate wholesale tier. */
export function resolveWholesalePrice(
  vendorPrice: number,
  wholesalePrice?: number | string | null
): number {
  const vendor = roundMoney(parseMoney(vendorPrice))
  if (wholesalePrice == null || wholesalePrice === '') return vendor
  const wholesale = parseMoney(wholesalePrice)
  if (wholesale < 0 || Number.isNaN(wholesale)) return vendor
  return roundMoney(wholesale)
}

export function isWholesalePriceSpecified(wholesalePrice?: number | string | null): boolean {
  if (wholesalePrice == null || wholesalePrice === '') return false
  const n = parseMoney(wholesalePrice)
  return Number.isFinite(n) && !Number.isNaN(n)
}

export function formatShopPriceBreakdown(pricing: {
  vendorPrice: number
  markup: number
  addOnTotal: number
  shopPrice: number
}): string {
  const parts = [
    `vendor ${pricing.vendorPrice.toFixed(2)}`,
    `markup ${pricing.markup.toFixed(2)}`,
  ]
  if (pricing.addOnTotal > 0) {
    parts.push(`add-ons ${pricing.addOnTotal.toFixed(2)}`)
  }
  return `GHS ${pricing.shopPrice.toFixed(2)} (${parts.join(' + ')})`
}

/**
 * Split a supermarket (Palace) line total into vendor due vs DistroGH markup.
 *
 * Supermarkets only know DistroGH as their supplier. `sheetLineTotal` / TCostEx is
 * DistroGH's price to the supermarket (`total_sales`), never the vendor payout.
 * Vendor due stays on catalog `vendor_price`; Distro markup is the remainder.
 */
export function computeImportSaleAmounts(
  quantity: number,
  sheetUnitPrice: number,
  catalogVendorPrice: number,
  sheetLineTotal?: number
): {
  unit_price: number
  total_sales: number
  vendor_due: number
  commission_amount: number
  price_warning: string | null
} {
  const qty = Math.max(0, quantity)
  const unit = roundMoney(sheetUnitPrice)
  const vendorUnit = roundMoney(catalogVendorPrice)
  const totalSales =
    sheetLineTotal != null && sheetLineTotal > 0
      ? roundMoney(sheetLineTotal)
      : roundMoney(qty * unit)
  let vendorDue = roundMoney(qty * vendorUnit)
  let commission = roundMoney(totalSales - vendorDue)
  let price_warning: string | null = null

  if (commission < 0) {
    price_warning =
      'Spreadsheet unit price is below catalog vendor price — vendor due capped at sale total'
    vendorDue = totalSales
    commission = 0
  }

  return {
    unit_price: unit,
    total_sales: totalSales,
    vendor_due: vendorDue,
    commission_amount: commission,
    price_warning,
  }
}

/**
 * Load-bearing: if Palace/supermarket TCostEx matches Distro's catalog shop price
 * (vendor + markup), vendor_due must not equal that total. When TCostEx is only
 * the vendor cost, vendor_due === total_sales is valid even if the catalog has markup.
 */
export function assertSupermarketTotalNotStoredAsVendorDue(args: {
  totalSales: number
  vendorDue: number
  catalogMarkup: number
  catalogShopTotal?: number
}): void {
  const markup = roundMoney(args.catalogMarkup)
  if (markup <= 0) return
  const total = roundMoney(args.totalSales)
  const due = roundMoney(args.vendorDue)
  if (total <= 0 || Math.abs(total - due) > 0.05) return
  const shop = args.catalogShopTotal != null ? roundMoney(args.catalogShopTotal) : null
  if (shop == null || Math.abs(shop - total) > 0.05) return
  throw new Error(
    "Supermarket TCostEx is DistroGH's shop total, not vendor due. Split using catalog vendor_price before saving."
  )
}
