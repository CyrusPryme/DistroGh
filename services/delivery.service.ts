import { apiFetch, apiFetchNullable } from '@/lib/api/client'
import { intakeService } from '@/services/intake.service'
import type { DeliveryRun, DeliveryRunItem, DeliveryRunVendorCharge } from '@/types'

export interface DeliveryChargeAllocation {
  total_transport_cost: number
  supermarket_label: string
  delivery_date: string
  confirmed: boolean
  preview: DeliveryRunVendorCharge[]
  applied: DeliveryRunVendorCharge[] | null
}

export interface CreateDeliveryRunPayload {
  supermarket_id: string
  delivery_date?: string
  total_transport_cost: number
  notes?: string | null
  items: { product_id: string; quantity_delivered: number }[]
}

export const deliveryService = {
  async createRun(payload: CreateDeliveryRunPayload): Promise<DeliveryRun> {
    const validItems = payload.items?.filter((i) => i.product_id && i.quantity_delivered > 0) ?? []
    if (validItems.length > 0) {
      const stockRows = await intakeService.getStockByProduct()
      const onHandMap = new Map(stockRows.map((r) => [r.product_id, r.on_hand]))
      const nameMap = new Map(stockRows.map((r) => [r.product_id, r.product_name]))

      const requestedByProduct = new Map<string, number>()
      for (const item of validItems) {
        requestedByProduct.set(
          item.product_id,
          (requestedByProduct.get(item.product_id) ?? 0) + item.quantity_delivered
        )
      }

      const overages: string[] = []
      for (const [productId, requested] of requestedByProduct) {
        const onHand = onHandMap.get(productId) ?? 0
        if (requested > onHand) {
          const name = nameMap.get(productId) ?? 'Unknown'
          overages.push(`${name}: requested ${requested}, on hand ${onHand}`)
        }
      }
      if (overages.length > 0) {
        throw new Error(`Cannot deliver more than stock on hand. ${overages.join('; ')}`)
      }
    }

    return apiFetch<DeliveryRun>('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supermarket_id: payload.supermarket_id,
        delivery_date: payload.delivery_date,
        total_transport_cost: payload.total_transport_cost,
        notes: payload.notes,
        items: payload.items,
      }),
      fallbackError: 'Failed to create delivery run',
    })
  },

  async getRunById(id: string): Promise<DeliveryRun | null> {
    return apiFetchNullable<DeliveryRun>(`/api/deliveries/${id}`, {
      fallbackError: 'Failed to load delivery',
    })
  },

  async confirmRun(
    runId: string,
    options?: {
      total_transport_cost?: number
      vendor_charges?: {
        vendor_id: string
        vendor_name?: string
        quantity_delivered: number
        share_percent?: number
        allocated_amount: number
      }[]
    }
  ): Promise<DeliveryRun> {
    return apiFetch<DeliveryRun>(`/api/deliveries/${runId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
      fallbackError: 'Failed to confirm delivery',
    })
  },

  async getChargeAllocation(runId: string): Promise<DeliveryChargeAllocation> {
    return apiFetch<DeliveryChargeAllocation>(`/api/deliveries/${runId}/charge-allocation`, {
      fallbackError: 'Failed to load transport charge split',
    })
  },

  async getAllRuns(filters?: { supermarket_id?: string; from?: string; to?: string }): Promise<DeliveryRun[]> {
    const params = new URLSearchParams()
    if (filters?.supermarket_id) params.set('supermarket_id', filters.supermarket_id)
    if (filters?.from) params.set('from', filters.from)
    if (filters?.to) params.set('to', filters.to)
    const qs = params.toString()
    return apiFetch<DeliveryRun[]>(`/api/deliveries${qs ? `?${qs}` : ''}`, {
      fallbackError: 'Failed to load deliveries',
    })
  },

  async getPendingDeliveryCount(): Promise<number> {
    try {
      const data = await apiFetch<{ count: number }>('/api/deliveries/pending-count')
      return Number(data?.count ?? 0)
    } catch {
      return 0
    }
  },

  async getTransportCostBySupermarket(supermarketId: string, from?: string, to?: string): Promise<number> {
    const runs = await this.getAllRuns({ supermarket_id: supermarketId, from, to })
    return runs.reduce((sum, r) => sum + Number(r.total_transport_cost ?? 0), 0)
  },

  async getTotalTransportCostInRange(from: string, to: string): Promise<number> {
    const runs = await this.getAllRuns({ from, to })
    return runs.reduce((sum, r) => sum + Number(r.total_transport_cost ?? 0), 0)
  },

  async getConfirmedDeliveriesForVendor(
    vendorId: string,
    filters?: { from?: string; to?: string; supermarket_id?: string }
  ): Promise<{
    run_id: string
    delivery_date: string
    confirmed_at: string
    supermarket_id: string
    supermarket_name: string
    items: { product_id: string; product_name: string; quantity_delivered: number }[]
  }[]> {
    const params = new URLSearchParams({ vendor_id: vendorId, confirmed: '1' })
    if (filters?.from) params.set('from', filters.from)
    if (filters?.to) params.set('to', filters.to)
    if (filters?.supermarket_id) params.set('supermarket_id', filters.supermarket_id)

    const runs = await apiFetch<DeliveryRun[]>(`/api/deliveries?${params}`, {
      fallbackError: 'Failed to load deliveries',
    })
    return runs.map((run) => ({
      run_id: run.id,
      delivery_date: run.delivery_date,
      confirmed_at: (run as DeliveryRun & { confirmed_at: string }).confirmed_at,
      supermarket_id: run.supermarket_id,
      supermarket_name: (run.supermarket as { name?: string })?.name ?? 'Unknown',
      items: ((run.items ?? []) as DeliveryRunItem[]).map((item) => ({
        product_id: item.product_id,
        product_name: (item.product as { name?: string })?.name ?? 'Unknown',
        quantity_delivered: Number(item.quantity_delivered) || 0,
      })),
    }))
  },

  async getTransportCostReport(
    from: string,
    to: string
  ): Promise<{
    total: number
    bySupermarket: {
      supermarket_id: string
      supermarket_name: string
      total_transport_cost: number
      run_count: number
    }[]
  }> {
    const runs = await this.getAllRuns({ from, to })
    const byId = new Map<string, { supermarket_name: string; total_transport_cost: number; run_count: number }>()
    for (const run of runs) {
      const sid = run.supermarket_id
      const name = (run.supermarket as { name?: string })?.name ?? 'Unknown'
      const cost = Number(run.total_transport_cost ?? 0)
      if (!byId.has(sid)) byId.set(sid, { supermarket_name: name, total_transport_cost: 0, run_count: 0 })
      const row = byId.get(sid)!
      row.total_transport_cost += cost
      row.run_count += 1
    }
    const bySupermarket = [...byId.entries()]
      .map(([supermarket_id, row]) => ({
        supermarket_id,
        supermarket_name: row.supermarket_name,
        total_transport_cost: row.total_transport_cost,
        run_count: row.run_count,
      }))
      .sort((a, b) => b.total_transport_cost - a.total_transport_cost)
    const total = bySupermarket.reduce((s, r) => s + r.total_transport_cost, 0)
    return { total, bySupermarket }
  },
}
