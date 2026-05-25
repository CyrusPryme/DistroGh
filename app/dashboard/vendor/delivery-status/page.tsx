'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useSession } from '@/hooks/useSession'
import { deliveryService } from '@/services/delivery.service'
import { supermarketService } from '@/services/supermarket.service'
import { Truck, Package, Loader2, AlertCircle, CheckCircle2, Filter } from 'lucide-react'
import { formatDate, formatNumber } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import type { Supermarket } from '@/types'

export default function VendorDeliveryStatusPage() {
  const { vendorId, loading: sessionLoading } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [deliveries, setDeliveries] = useState<
    {
      run_id: string
      delivery_date: string
      confirmed_at: string
      supermarket_id: string
      supermarket_name: string
      items: { product_id: string; product_name: string; quantity_delivered: number }[]
    }[]
  >([])
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterSupermarket, setFilterSupermarket] = useState('')
  const [delPage, setDelPage] = useState(1)

  useEffect(() => {
    setDelPage(1)
  }, [filterFrom, filterTo, filterSupermarket])

  useEffect(() => {
    if (sessionLoading) return
    if (!vendorId) {
      setLoading(false)
      setError('No vendor linked to your account.')
      return
    }
    setLoading(true)
    Promise.all([
      deliveryService.getConfirmedDeliveriesForVendor(vendorId, {
        from: filterFrom || undefined,
        to: filterTo || undefined,
        supermarket_id: filterSupermarket || undefined,
      }),
      supermarketService.getAll(),
    ])
      .then(([dels, sm]) => {
        setDeliveries(Array.isArray(dels) ? dels : [])
        setSupermarkets(Array.isArray(sm) ? sm : [])
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load delivery status')
      })
      .finally(() => setLoading(false))
  }, [sessionLoading, vendorId, filterFrom, filterTo, filterSupermarket])

  const paginatedDeliveries = useMemo(
    () => getPageSlice(deliveries, delPage, DEFAULT_PAGE_SIZE),
    [deliveries, delPage]
  )

  if (loading && !vendorId) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (error || vendorId == null) {
    return (
      <div className="page-container">
        <div className="data-card text-center py-12">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{error || 'Unable to load delivery status'}</p>
          <Link href="/dashboard/vendor" className="mt-4 inline-block text-brand-600 hover:text-brand-700 text-sm font-medium">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Delivery Status</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Which supermarkets received your products and when (confirmed deliveries only). Read-only.
        </p>
      </div>

      {/* Filters */}
      <div className="data-card py-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Filter</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="form-input text-sm w-40"
            placeholder="From"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="form-input text-sm w-40"
            placeholder="To"
          />
          <select
            value={filterSupermarket}
            onChange={(e) => setFilterSupermarket(e.target.value)}
            className="form-input text-sm w-48 appearance-none"
          >
            <option value="">All supermarkets</option>
            {supermarkets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {(filterFrom || filterTo || filterSupermarket) && (
            <button
              type="button"
              onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterSupermarket('') }}
              className="text-xs text-brand-600 hover:underline font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="data-card flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      ) : deliveries.length === 0 ? (
        <div className="data-card text-center py-12">
          <Truck className="w-14 h-14 text-slate-300 mx-auto mb-4" />
          <h3 className="font-display text-lg font-semibold text-slate-600">No confirmed deliveries</h3>
          <p className="text-slate-500 text-sm mt-2">
            No confirmed deliveries for your products in this period. Deliveries appear here once they are confirmed by DistroGH.
          </p>
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supermarket</th>
                  <th>Delivery date</th>
                  <th>Confirmed</th>
                  <th>Products delivered</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDeliveries.map((d) => (
                  <tr key={d.run_id}>
                    <td className="font-medium text-slate-800">{d.supermarket_name}</td>
                    <td className="text-slate-600">{formatDate(d.delivery_date)}</td>
                    <td className="text-emerald-600 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      {formatDate(d.confirmed_at)}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {d.items.map((it) => (
                          <span key={it.product_id} className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                            <Package className="w-3.5 h-3.5 text-slate-400" />
                            {it.product_name}: {formatNumber(it.quantity_delivered)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={delPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={deliveries.length}
              onPageChange={setDelPage}
            />
          </div>
        </div>
      )}
    </div>
  )
}
