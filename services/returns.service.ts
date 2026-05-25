import { apiFetch } from '@/lib/api/client'
import type { ProductReturn, ReturnReason } from '@/types'

export interface CreateReturnPayload {
  product_id: string
  supermarket_id: string
  quantity_returned: number
  unit_price: number
  reason: ReturnReason
  reason_notes?: string | null
  return_date?: string
}

export const returnsService = {
  async create(payload: CreateReturnPayload): Promise<ProductReturn> {
    return apiFetch<ProductReturn>('/api/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: payload.product_id,
        supermarket_id: payload.supermarket_id,
        quantity_returned: payload.quantity_returned,
        unit_price: payload.unit_price,
        reason: payload.reason,
        reason_notes: payload.reason_notes?.trim() || null,
        return_date: payload.return_date,
      }),
      fallbackError: 'Failed to create return',
    })
  },

  async getAll(filters?: {
    product_id?: string
    supermarket_id?: string
    vendor_id?: string
    from?: string
    to?: string
  }): Promise<ProductReturn[]> {
    const params = new URLSearchParams()
    if (filters?.product_id) params.set('product_id', filters.product_id)
    if (filters?.supermarket_id) params.set('supermarket_id', filters.supermarket_id)
    if (filters?.vendor_id) params.set('vendor_id', filters.vendor_id)
    if (filters?.from) params.set('from', filters.from)
    if (filters?.to) params.set('to', filters.to)
    const qs = params.toString()
    return apiFetch<ProductReturn[]>(`/api/returns${qs ? `?${qs}` : ''}`, {
      fallbackError: 'Failed to load returns',
    })
  },

  async getInDateRange(start: string, end: string): Promise<ProductReturn[]> {
    return this.getAll({ from: start, to: end })
  },

  async getByProduct(productId: string): Promise<ProductReturn[]> {
    return this.getAll({ product_id: productId })
  },

  async getTopReturnedProducts(
    limit = 5
  ): Promise<
    { product_id: string; product_name: string; total_quantity_returned: number; return_count: number }[]
  > {
    const data = await this.getAll()
    const byProduct = new Map<
      string,
      { product_name: string; total_quantity_returned: number; return_count: number }
    >()
    for (const row of data) {
      const pid = row.product_id
      const name = row.product?.name ?? 'Unknown'
      if (!byProduct.has(pid)) {
        byProduct.set(pid, { product_name: name, total_quantity_returned: 0, return_count: 0 })
      }
      const r = byProduct.get(pid)!
      r.total_quantity_returned += Number(row.quantity_returned ?? 0)
      r.return_count += 1
    }
    return Array.from(byProduct.entries())
      .map(([product_id, r]) => ({ product_id, ...r }))
      .sort((a, b) => b.total_quantity_returned - a.total_quantity_returned)
      .slice(0, limit)
  },
}
