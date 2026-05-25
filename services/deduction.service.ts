import { apiFetch } from '@/lib/api/client'
import type { VendorDeduction } from '@/types'

export interface CreateDeductionPayload {
  vendor_id: string
  amount: number
  reason: string
  deduction_date?: string
  reference_id?: string | null
  reference_type?: string | null
}

export const deductionService = {
  async create(payload: CreateDeductionPayload): Promise<VendorDeduction> {
    return apiFetch<VendorDeduction>('/api/deductions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_id: payload.vendor_id,
        amount: payload.amount,
        reason: payload.reason.trim(),
        deduction_date: payload.deduction_date,
        reference_id: payload.reference_id ?? null,
        reference_type: payload.reference_type ?? null,
      }),
      fallbackError: 'Failed to create deduction',
    })
  },

  async getByVendor(vendorId: string, from?: string, to?: string): Promise<VendorDeduction[]> {
    const params = new URLSearchParams({ vendor_id: vendorId })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return apiFetch<VendorDeduction[]>(`/api/deductions?${params}`, {
      fallbackError: 'Failed to load deductions',
    })
  },
}
