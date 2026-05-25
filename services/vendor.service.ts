import { apiFetch, apiFetchNullable } from '@/lib/api/client'
import { Vendor, VendorFormData, VendorBalance } from '@/types'

export const vendorService = {
  async getAll(): Promise<Vendor[]> {
    const rows = await apiFetch<Vendor[]>('/api/vendors', { fallbackError: 'Failed to load vendors' })
    const seen = new Map<string, Vendor>()
    for (const v of rows) {
      const key = `${(v.name ?? '').trim().toLowerCase()}|${(v.momo_number ?? '').trim()}`
      if (!seen.has(key)) seen.set(key, v)
    }
    return Array.from(seen.values()).sort((a, b) => {
      const da = a.deleted_at ? 1 : 0
      const db = b.deleted_at ? 1 : 0
      if (da !== db) return da - db
      return (a.name ?? '').localeCompare(b.name ?? '')
    })
  },

  async getWithAccounts(): Promise<Vendor[]> {
    const rows = await apiFetch<Vendor[]>('/api/vendors', { fallbackError: 'Failed to load vendors' })
    return rows
      .filter(
        (v) =>
          !v.deleted_at &&
          v.login_email != null &&
          String(v.login_email).trim().length > 0
      )
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  },

  async getById(id: string): Promise<Vendor | null> {
    return apiFetchNullable<Vendor>(`/api/vendors/${id}`, { fallbackError: 'Failed to load vendor' })
  },

  async create(payload: VendorFormData): Promise<Vendor> {
    return apiFetch<Vendor>('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      fallbackError: 'Failed to create vendor',
    })
  },

  async update(id: string, payload: Partial<VendorFormData>): Promise<Vendor> {
    if (payload.default_commission !== undefined) {
      if (payload.default_commission < 0 || payload.default_commission > 100) {
        throw new Error('Commission must be between 0 and 100 percent')
      }
    }
    if (payload.name !== undefined && (!payload.name || payload.name.trim().length === 0)) {
      throw new Error('Vendor name cannot be empty')
    }
    if (payload.momo_number !== undefined && (!payload.momo_number || payload.momo_number.trim().length === 0)) {
      throw new Error('Mobile money number cannot be empty')
    }
    if (payload.momo_network !== undefined && !['MTN', 'Vodafone', 'AirtelTigo'].includes(payload.momo_network)) {
      throw new Error('Invalid mobile money network')
    }

    return apiFetch<Vendor>(`/api/vendors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      fallbackError: 'Failed to update vendor',
    })
  },

  async softDelete(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/vendors/${id}`, {
      method: 'DELETE',
      fallbackError: 'Failed to delete vendor',
    })
  },

  async restore(id: string): Promise<void> {
    await apiFetch<unknown>(`/api/vendors/${id}/restore`, {
      method: 'POST',
      fallbackError: 'Failed to restore vendor',
    })
  },

  async delete(id: string): Promise<void> {
    return this.softDelete(id)
  },

  async getBalances(): Promise<VendorBalance[]> {
    return apiFetch<VendorBalance[]>('/api/vendors/balances', {
      fallbackError: 'Failed to load vendor balances',
    })
  },

  async getVendorWithProducts(id: string) {
    const [vendor, products] = await Promise.all([
      this.getById(id),
      apiFetch<unknown[]>(`/api/products?vendor_id=${encodeURIComponent(id)}`, {
        fallbackError: 'Failed to load products',
      }),
    ])
    if (!vendor) throw new Error('Vendor not found')
    return { ...vendor, products }
  },

  async getVendorStatement(vendorId: string, from: string, to: string) {
    const params = new URLSearchParams({ range_start: from, range_end: to, vendor_id: vendorId })
    const [salesRows, returnRows, payoutRows] = await Promise.all([
      apiFetch<{ total_sales: number; commission_amount: number; vendor_due: number }[]>(
        `/api/sales?${params}`,
        { fallbackError: 'Failed to load sales' }
      ),
      apiFetch<{ quantity_returned: number; unit_price: number; product?: { vendor_price?: number } }[]>(
        `/api/returns?vendor_id=${encodeURIComponent(vendorId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { fallbackError: 'Failed to load returns' }
      ),
      apiFetch<{ amount_paid: number; payout_date?: string | null }[]>(
        `/api/payouts?vendor_id=${encodeURIComponent(vendorId)}`,
        { fallbackError: 'Failed to load payouts' }
      ),
    ])

    const sales = salesRows.map((s) => ({
      total_sales: Number(s.total_sales ?? 0),
      commission_amount: Number(s.commission_amount ?? 0),
      vendor_due: Number(s.vendor_due ?? 0),
    }))

    const returns = returnRows.map((r) => ({
      quantity_returned: Number(r.quantity_returned ?? 0),
      unit_price: Number(r.unit_price ?? 0),
      vendor_price: Number(r.product?.vendor_price ?? 0),
    }))

    const payouts = payoutRows
      .filter((p) => {
        if (!p.payout_date) return false
        const d = String(p.payout_date).slice(0, 10)
        return d >= from && d <= to
      })
      .map((p) => ({ amount_paid: Number(p.amount_paid ?? 0) }))

    return { sales, returns, payouts }
  },

  async getVendorPayoutHistory(vendorId: string) {
    return apiFetch<unknown[]>(`/api/payouts?vendor_id=${encodeURIComponent(vendorId)}`, {
      fallbackError: 'Failed to load payouts',
    })
  },

  async getVendorSales(vendorId: string) {
    return apiFetch<unknown[]>(`/api/sales?vendor_id=${encodeURIComponent(vendorId)}`, {
      fallbackError: 'Failed to load sales',
    })
  },

  async getVendorBalance(vendorId: string): Promise<number> {
    const data = await apiFetch<{ balance: number }>(`/api/vendors/${vendorId}/balance`, {
      fallbackError: 'Failed to load balance',
    })
    return Number(data.balance ?? 0)
  },

  async getAllVendorBalances(): Promise<Array<{ vendor_id: string; vendor_name: string; total_due: number }>> {
    const balances = await this.getBalances()
    return balances.map((b) => ({
      vendor_id: b.vendor_id,
      vendor_name: b.vendor_name,
      total_due: b.balance,
    }))
  },
}
