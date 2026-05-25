import { apiFetch } from '@/lib/api/client'
import type { Intake } from '@/types'

export interface CreateIntakePayload {
  vendor_id: string
  product_id: string
  quantity_received: number
  received_date?: string
  reference?: string | null
}

export const intakeService = {
  async create(payload: CreateIntakePayload): Promise<Intake> {
    await apiFetch<unknown>('/api/intakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([payload]),
      fallbackError: 'Failed to create intake',
    })
    const rows = await this.getAll({ vendor_id: payload.vendor_id, product_id: payload.product_id })
    return rows[0] as Intake
  },

  async bulkCreate(
    payloads: {
      vendor_id: string
      product_id: string
      quantity_received: number
      received_date?: string
      reference?: string | null
    }[]
  ): Promise<void> {
    if (payloads.length === 0) return
    await apiFetch<unknown>('/api/intakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloads),
      fallbackError: 'Failed to create intakes',
    })
  },

  async getAll(filters?: {
    vendor_id?: string
    product_id?: string
    from?: string
    to?: string
  }): Promise<Intake[]> {
    const qs = new URLSearchParams()
    if (filters?.vendor_id) qs.set('vendor_id', filters.vendor_id)
    if (filters?.product_id) qs.set('product_id', filters.product_id)
    if (filters?.from) qs.set('from', filters.from)
    if (filters?.to) qs.set('to', filters.to)
    const query = qs.toString()
    return apiFetch<Intake[]>(`/api/intakes${query ? `?${query}` : ''}`, {
      fallbackError: 'Failed to load intakes',
    })
  },

  async getStockByProduct(
    vendorId?: string
  ): Promise<{ product_id: string; product_name: string; received: number; delivered: number; on_hand: number }[]> {
    const qs = new URLSearchParams()
    if (vendorId) qs.set('vendor_id', vendorId)
    const query = qs.toString()
    return apiFetch(`/api/intakes/stock${query ? `?${query}` : ''}`, {
      fallbackError: 'Failed to load stock',
    })
  },

  async getTopVendorsByIntake(
    limit = 5
  ): Promise<{ vendor_id: string; vendor_name: string; total_quantity_received: number }[]> {
    const rows = await this.getAll()
    const byVendor = new Map<string, { vendor_name: string; total_quantity_received: number }>()
    for (const row of rows) {
      const vid = row.vendor_id
      const name = row.vendor?.name ?? 'Unknown'
      if (!byVendor.has(vid)) byVendor.set(vid, { vendor_name: name, total_quantity_received: 0 })
      byVendor.get(vid)!.total_quantity_received += Number(row.quantity_received ?? 0)
    }
    return Array.from(byVendor.entries())
      .map(([vendor_id, r]) => ({ vendor_id, ...r }))
      .sort((a, b) => b.total_quantity_received - a.total_quantity_received)
      .slice(0, limit)
  },
}
