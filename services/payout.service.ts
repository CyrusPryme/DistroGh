import { apiFetch } from '@/lib/api/client'
import { Payout } from '@/types'

export const payoutService = {
  async getAll(): Promise<Payout[]> {
    return apiFetch<Payout[]>('/api/payouts', { fallbackError: 'Failed to load payouts' })
  },

  async getByStatus(status: string): Promise<Payout[]> {
    return apiFetch<Payout[]>(`/api/payouts?status=${encodeURIComponent(status)}`, {
      fallbackError: 'Failed to load payouts',
    })
  },

  async getByVendor(vendorId: string): Promise<Payout[]> {
    return apiFetch<Payout[]>(`/api/payouts?vendor_id=${encodeURIComponent(vendorId)}`, {
      fallbackError: 'Failed to load payouts',
    })
  },

  async create(payload: {
    vendor_id: string
    amount_due: number
    week_start: string
    week_end: string
  }): Promise<Payout> {
    return apiFetch<Payout>('/api/payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      fallbackError: 'Failed to create payout',
    })
  },

  async markCompleted(
    id: string,
    payload: { amount_paid: number; momo_txn_id: string }
  ): Promise<Payout> {
    return this.recordPayment(id, {
      payment_amount: payload.amount_paid,
      momo_txn_id: payload.momo_txn_id,
    })
  },

  async recordPayment(
    id: string,
    payload: { payment_amount: number; momo_txn_id?: string }
  ): Promise<Payout> {
    return apiFetch<Payout>(`/api/payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record_payment: true,
        payment_amount: payload.payment_amount,
        momo_txn_id: payload.momo_txn_id ?? '',
      }),
      fallbackError: 'Failed to record payment',
    })
  },

  async getPendingSummary(): Promise<{
    pending_payout_count: number
    pending_payout_balance: number
    vendor_balance_count: number
    vendor_balance_total: number
    alert_count: number
  }> {
    return apiFetch('/api/payouts/pending-summary', {
      fallbackError: 'Failed to load payout summary',
    })
  },

  async markFailed(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed' }),
      fallbackError: 'Failed to update payout',
    })
  },

  async updateStatus(id: string, status: string, txnId?: string): Promise<Payout> {
    const updates: Record<string, unknown> = { status }
    if (txnId) updates.momo_txn_id = txnId
    return apiFetch<Payout>(`/api/payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      fallbackError: 'Failed to update payout',
    })
  },

  async bulkCreateForVendors(
    vendorBalances: Array<{ vendor_id: string; balance: number }>,
    weekStart: string,
    weekEnd: string
  ): Promise<void> {
    await apiFetch<unknown>('/api/payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_balances: vendorBalances,
        week_start: weekStart,
        week_end: weekEnd,
      }),
      fallbackError: 'Failed to bulk create payouts',
    })
  },

  async softDelete(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/payouts/${id}`, {
      method: 'DELETE',
      fallbackError: 'Failed to delete payout',
    })
  },

  async restore(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/payouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted_at: null }),
      fallbackError: 'Failed to restore payout',
    })
  },

  async delete(id: string): Promise<void> {
    return this.softDelete(id)
  },
}
