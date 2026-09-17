import { apiFetch } from '@/lib/api/client'
import type { StockTimelineEvent, StockTimelineSummary } from '@/lib/vendor-stock-timeline'

export type StockTimelineResponse = {
  product_id: string
  product_name: string
  vendor_name: string
  period: { from: string | null; to: string | null }
  summary: StockTimelineSummary
  events: StockTimelineEvent[]
}

export const vendorStockTimelineService = {
  async get(params: { productId: string; from?: string; to?: string }): Promise<StockTimelineResponse> {
    const qs = new URLSearchParams()
    qs.set('product_id', params.productId)
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    return apiFetch<StockTimelineResponse>(`/api/vendors/stock-timeline?${qs.toString()}`, {
      fallbackError: 'Failed to load stock timeline',
    })
  },
}
