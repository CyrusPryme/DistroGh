/** Resolve vendor price, markup, and shop (supermarket) price from product fields. */

export type ProductPricingFields = {
  vendor_price?: number | string | null
  distrogh_markup?: number | string | null
  selling_price?: number | string | null
}

export function resolveProductPricing(product: ProductPricingFields | null | undefined): {
  vendorPrice: number
  markup: number
  shopPrice: number
  vendorPriceInferred: boolean
} {
  if (!product) return { vendorPrice: 0, markup: 0, shopPrice: 0, vendorPriceInferred: false }

  const markup = Number(product.distrogh_markup ?? 0)
  const selling = Number(product.selling_price ?? 0)
  let vendorPrice = Number(product.vendor_price ?? 0)
  let vendorPriceInferred = false

  if ((Number.isNaN(vendorPrice) || vendorPrice <= 0) && selling > 0) {
    const inferred = Math.round((selling - markup) * 100) / 100
    if (inferred > 0) {
      vendorPrice = inferred
      vendorPriceInferred = true
    }
  }

  const shopPrice =
    selling > 0
      ? Math.round(selling * 100) / 100
      : Math.round((vendorPrice + markup) * 100) / 100

  return {
    vendorPrice: Number.isNaN(vendorPrice) ? 0 : vendorPrice,
    markup: Number.isNaN(markup) ? 0 : markup,
    shopPrice,
    vendorPriceInferred,
  }
}
