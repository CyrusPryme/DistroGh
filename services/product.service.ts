import { apiFetch, apiFetchNullable } from '@/lib/api/client'
import { Product, ProductFormData } from '@/types'

export const productService = {
  async getAll(): Promise<Product[]> {
    return apiFetch<Product[]>('/api/products', { fallbackError: 'Failed to load products' })
  },

  async getById(id: string): Promise<Product | null> {
    return apiFetchNullable<Product>(`/api/products/${id}`, { fallbackError: 'Failed to load product' })
  },

  async getByVendor(vendorId: string): Promise<Product[]> {
    return apiFetch<Product[]>(`/api/products?vendor_id=${encodeURIComponent(vendorId)}`, {
      fallbackError: 'Failed to load products',
    })
  },

  async create(payload: ProductFormData): Promise<Product> {
    if (payload.vendor_price < 0 || payload.distrogh_markup < 0) {
      throw new Error('Vendor price and DistroGH markup cannot be negative')
    }
    if (payload.vendor_price === 0 && payload.distrogh_markup === 0) {
      throw new Error('At least one of vendor price or DistroGH markup must be greater than 0')
    }
    if (!payload.name || payload.name.trim().length === 0) {
      throw new Error('Product name is required')
    }
    if (!payload.vendor_id || payload.vendor_id.trim().length === 0) {
      throw new Error('Vendor ID is required')
    }

    const insertPayload = {
      name: payload.name,
      vendor_id: payload.vendor_id,
      vendor_price: payload.vendor_price,
      distrogh_markup: payload.distrogh_markup,
      selling_price: payload.vendor_price + payload.distrogh_markup,
      commission_percent: 0,
      expiry_date:
        payload.expiry_date && String(payload.expiry_date).trim()
          ? String(payload.expiry_date).trim()
          : null,
    }
    return apiFetch<Product>('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(insertPayload),
      fallbackError: 'Failed to create product',
    })
  },

  async update(id: string, payload: Partial<ProductFormData>): Promise<Product> {
    if (payload.vendor_price !== undefined && payload.vendor_price < 0) {
      throw new Error('Vendor price cannot be negative')
    }
    if (payload.distrogh_markup !== undefined && payload.distrogh_markup < 0) {
      throw new Error('DistroGH markup cannot be negative')
    }
    if (payload.name !== undefined && (!payload.name || payload.name.trim().length === 0)) {
      throw new Error('Product name cannot be empty')
    }
    if (payload.vendor_id !== undefined && (!payload.vendor_id || payload.vendor_id.trim().length === 0)) {
      throw new Error('Vendor ID cannot be empty')
    }

    const updatePayload: Record<string, unknown> = { ...payload }
    const vp = payload.vendor_price ?? (payload as ProductFormData).vendor_price
    const dm = payload.distrogh_markup ?? (payload as ProductFormData).distrogh_markup
    if (vp !== undefined && dm !== undefined) {
      updatePayload.selling_price = vp + dm
    } else if (vp !== undefined || dm !== undefined) {
      const existing = await this.getById(id)
      const evp = vp ?? existing?.vendor_price ?? 0
      const edm = dm ?? existing?.distrogh_markup ?? 0
      updatePayload.selling_price = evp + edm
    }
    if ('expiry_date' in updatePayload) {
      updatePayload.expiry_date =
        updatePayload.expiry_date && String(updatePayload.expiry_date).trim()
          ? String(updatePayload.expiry_date).trim()
          : null
    }
    if ('sku' in updatePayload) updatePayload.sku = (updatePayload.sku as string)?.trim() || null
    if ('barcode' in updatePayload) updatePayload.barcode = (updatePayload.barcode as string)?.trim() || null
    if ('category' in updatePayload) updatePayload.category = (updatePayload.category as string)?.trim() || null
    if ('packaging_size' in updatePayload) {
      updatePayload.packaging_size = (updatePayload.packaging_size as string)?.trim() || null
    }
    if ('wholesale_price' in updatePayload) {
      const v = updatePayload.wholesale_price
      updatePayload.wholesale_price =
        v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null
    }
    if ('mall_retail_price' in updatePayload) {
      const v = updatePayload.mall_retail_price
      updatePayload.mall_retail_price =
        v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null
    }
    if ('moq' in updatePayload) {
      const v = updatePayload.moq
      updatePayload.moq = v != null && v !== '' && Number(v) >= 1 ? Math.floor(Number(v)) : 1
    }
    return apiFetch<Product>(`/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
      fallbackError: 'Failed to update product',
    })
  },

  async softDelete(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/products/${id}`, {
      method: 'DELETE',
      fallbackError: 'Failed to delete product',
    })
  },

  async restore(_id: string): Promise<void> {
    throw new Error('Restore not implemented in Postgres API yet')
  },

  async delete(id: string): Promise<void> {
    return this.softDelete(id)
  },

  async getAllForMatching(
    vendorId?: string
  ): Promise<Pick<Product, 'id' | 'name' | 'vendor_id' | 'vendor_price' | 'distrogh_markup' | 'selling_price'>[]> {
    const url = vendorId ? `/api/products?vendor_id=${encodeURIComponent(vendorId)}` : '/api/products'
    const rows = await apiFetch<Product[]>(url, { fallbackError: 'Failed to load products' })
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      vendor_id: row.vendor_id,
      vendor_price: row.vendor_price ?? 0,
      distrogh_markup: row.distrogh_markup ?? 0,
      selling_price: row.selling_price,
    }))
  },
}
