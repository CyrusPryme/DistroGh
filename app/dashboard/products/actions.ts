'use server'

import { getDbPool } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require'
import type { ProductFormValues } from '@/lib/validations'
import type { Product } from '@/types'
import { computeShopUnitPrice, resolveWholesalePrice } from '@/lib/product-pricing'

function toNum(v: unknown): number | null {
  if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export async function createProductAdmin(
  payload: ProductFormValues,
  productImagePaths?: string[]
): Promise<{ product: Product } | { error: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Only admins can add products' }
  }

  if (payload.vendor_price < 0 || payload.distrogh_markup < 0) {
    return { error: 'Vendor price and DistroGH markup cannot be negative' }
  }
  if (payload.vendor_price === 0 && payload.distrogh_markup === 0) {
    return { error: 'At least one of vendor price or DistroGH markup must be greater than 0' }
  }
  if (!payload.name?.trim()) return { error: 'Product name is required' }
  if (!payload.vendor_id?.trim()) return { error: 'Vendor ID is required' }

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    insert into public.products (
      name, vendor_id, vendor_price, distrogh_markup, selling_price, commission_percent,
      expiry_date, sku, barcode, category, packaging_size, wholesale_price, supermarket_selling_price, moq, product_image_paths
    )
    values ($1, $2::uuid, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    returning *
    `,
    [
      payload.name.trim(),
      payload.vendor_id,
      payload.vendor_price,
      payload.distrogh_markup,
      computeShopUnitPrice({
        vendor_price: payload.vendor_price,
        distrogh_markup: payload.distrogh_markup,
      }),
      payload.expiry_date && String(payload.expiry_date).trim() ? String(payload.expiry_date).trim() : null,
      payload.sku?.trim() || null,
      payload.barcode?.trim() || null,
      payload.category?.trim() || null,
      payload.packaging_size?.trim() || null,
      resolveWholesalePrice(payload.vendor_price, payload.wholesale_price),
      toNum(payload.supermarket_selling_price),
      payload.moq != null && payload.moq >= 1 ? Math.floor(payload.moq) : 1,
      Array.isArray(productImagePaths) && productImagePaths.length > 0 ? productImagePaths : [],
    ]
  )
  return { product: rows[0] as Product }
}
