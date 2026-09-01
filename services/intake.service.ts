import { apiFetch } from '@/lib/api/client'
import type { Intake, VendorIntakeLeaderboard } from '@/types'

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

  async getTopVendorsByIntake(limit = 5, range?: { from?: string; to?: string }): Promise<VendorIntakeLeaderboard[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (range?.from) params.set('from', range.from)
    if (range?.to) params.set('to', range.to)
    return apiFetch<VendorIntakeLeaderboard[]>(`/api/intakes/top-vendors?${params}`, {
      fallbackError: 'Failed to load top vendors by intake',
    })
  },
}
