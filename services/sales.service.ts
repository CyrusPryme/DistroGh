import { apiFetch } from '@/lib/api/client'
import { Sale, DashboardKPIs, WeeklyRevenue, ProductPerformance, VendorSalesBreakdown } from '@/types'

interface SaleInsert {
  product_id: string
  supermarket_id: string
  qty_sold: number
  unit_price: number
  commission_amount: number
  vendor_due: number
  week_start: string
  week_end: string
  import_batch_id: string
}

interface SalesFilter {
  week_start?: string
  week_end?: string
  vendor_id?: string
  product_id?: string
  supermarket_id?: string
}

function salesQuery(filters: SalesFilter = {}): string {
  const params = new URLSearchParams()
  if (filters.week_start) params.set('week_start', filters.week_start)
  if (filters.week_end) params.set('week_end', filters.week_end)
  if (filters.vendor_id) params.set('vendor_id', filters.vendor_id)
  if (filters.product_id) params.set('product_id', filters.product_id)
  if (filters.supermarket_id) params.set('supermarket_id', filters.supermarket_id)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const salesService = {
  async getAll(filters: SalesFilter = {}): Promise<Sale[]> {
    return apiFetch<Sale[]>(`/api/sales${salesQuery(filters)}`, { fallbackError: 'Failed to load sales' })
  },

  async bulkInsert(sales: SaleInsert[]): Promise<void> {
    await apiFetch<unknown>('/api/sales/bulk-insert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sales),
      fallbackError: 'Failed to import sales',
    })
  },

  async getDashboardKPIs(): Promise<DashboardKPIs> {
    return apiFetch<DashboardKPIs>('/api/sales/kpis', { fallbackError: 'Failed to load KPIs' })
  },

  async getRecentSales(limit = 10, vendorId?: string): Promise<Sale[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (vendorId) params.set('vendorId', vendorId)
    return apiFetch<Sale[]>(`/api/sales/recent?${params}`, { fallbackError: 'Failed to load recent sales' })
  },

  async softDelete(_id: string): Promise<void> {
    throw new Error('Sales delete not implemented in Postgres API yet')
  },

  async restore(_id: string): Promise<void> {
    throw new Error('Sales restore not implemented in Postgres API yet')
  },

  async delete(id: string): Promise<void> {
    return this.softDelete(id)
  },

  async getWeeklyRevenue(limit = 12, vendorId?: string): Promise<WeeklyRevenue[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (vendorId) params.set('vendorId', vendorId)
    return apiFetch<WeeklyRevenue[]>(`/api/sales/weekly-revenue?${params}`, {
      fallbackError: 'Failed to load weekly revenue',
    })
  },

  async getTopProducts(limit = 10, vendorId?: string): Promise<ProductPerformance[]> {
    const params = new URLSearchParams({ limit: String(limit), sort: 'desc' })
    if (vendorId) params.set('vendorId', vendorId)
    return apiFetch<ProductPerformance[]>(`/api/sales/top-products?${params}`, {
      fallbackError: 'Failed to load top products',
    })
  },

  async getBottomProducts(limit = 5): Promise<ProductPerformance[]> {
    const params = new URLSearchParams({ limit: String(Math.max(limit, 50)), sort: 'asc' })
    const rows = await apiFetch<ProductPerformance[]>(`/api/sales/top-products?${params}`, {
      fallbackError: 'Failed to load bottom products',
    })
    return rows.slice(0, limit)
  },

  async getTopSupermarketsBySales(limit = 5): Promise<
    { supermarket_id: string; supermarket_name: string; total_sales: number; total_qty: number }[]
  > {
    const params = new URLSearchParams({ limit: String(limit) })
    return apiFetch(`/api/sales/top-supermarkets?${params}`, {
      fallbackError: 'Failed to load top supermarkets',
    })
  },

  async getSalesInDateRange(start: string, end: string): Promise<Sale[]> {
    const params = new URLSearchParams({ range_start: start, range_end: end })
    return apiFetch<Sale[]>(`/api/sales?${params}`, { fallbackError: 'Failed to load sales' })
  },

  async getSalesByVendor(): Promise<VendorSalesBreakdown[]> {
    return apiFetch<VendorSalesBreakdown[]>('/api/sales/by-vendor', {
      fallbackError: 'Failed to load sales by vendor',
    })
  },
}
