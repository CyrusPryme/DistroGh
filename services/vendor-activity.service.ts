import { apiFetch } from '@/lib/api/client'
import type { VendorActivityProductRow, VendorActivityRow } from '@/lib/vendor-activity'

export type VendorActivityResponse = {
  vendors: VendorActivityRow[]
  period: { from: string | null; to: string | null }
  sold_counts_settled_only: boolean
}

export const vendorActivityService = {
  async getSummary(params: {
    vendorIds?: string[]
    from?: string
    to?: string
  }): Promise<VendorActivityResponse> {
    const qs = new URLSearchParams()
    if (params.vendorIds?.length) {
      qs.set('vendor_ids', params.vendorIds.join(','))
    }
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    const query = qs.toString()
    return apiFetch<VendorActivityResponse>(
      `/api/vendors/activity${query ? `?${query}` : ''}`,
      { fallbackError: 'Failed to load vendor activity' }
    )
  },

  async getProducts(params: {
    vendorId: string
    from?: string
    to?: string
  }): Promise<{
    vendor_id: string
    products: VendorActivityProductRow[]
    period: { from: string | null; to: string | null }
    sold_counts_settled_only: boolean
  }> {
    const qs = new URLSearchParams()
    qs.set('vendor_id', params.vendorId)
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    return apiFetch(`/api/vendors/activity/products?${qs.toString()}`, {
      fallbackError: 'Failed to load product breakdown',
    })
  },
}
