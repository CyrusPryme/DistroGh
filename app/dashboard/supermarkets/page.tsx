'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Building2, ShoppingCart, RotateCcw, Truck, ArrowRight, Loader2, AlertCircle } from 'lucide-react'
import { supermarketService, type SupermarketSummary } from '@/services/supermarket.service'
import { useSession } from '@/hooks/useSession'
import { formatGHS, formatNumber, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'

export default function SupermarketsPage() {
  useSession({ redirectVendorFromAdmin: true })
  const [list, setList] = useState<SupermarketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [smPage, setSmPage] = useState(1)

  useEffect(() => {
    async function load() {
      try {
        const data = await supermarketService.getSummaries().catch(() => [])
        setList(Array.isArray(data) ? data : [])
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load supermarkets')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const paginatedList = useMemo(
    () => getPageSlice(list, smPage, DEFAULT_PAGE_SIZE),
    [list, smPage]
  )

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="page-container space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Supermarkets</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Outlets you distribute to. Sales data comes from your imported Excel reports.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {list.length === 0 && !error ? (
        <div className="data-card text-center py-12">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">No supermarkets yet</p>
          <p className="text-slate-500 text-sm mt-1">Add supermarkets when you set up delivery runs or import sales.</p>
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Supermarket</th>
                  <th>Location</th>
                  <th className="text-right">Total sales</th>
                  <th className="text-right">Sales entries</th>
                  <th className="text-right">Returns</th>
                  <th className="text-right">Deliveries</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {paginatedList.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-800">{s.name}</span>
                      </div>
                    </td>
                    <td className="text-slate-600 text-sm">{s.location || '—'}</td>
                    <td className="text-right font-mono font-semibold text-slate-800">{formatGHS(s.total_sales ?? 0)}</td>
                    <td className="text-right font-mono text-slate-600">{formatNumber(s.sales_count ?? 0)}</td>
                    <td className="text-right font-mono text-slate-600">{formatNumber(s.return_count ?? 0)}</td>
                    <td className="text-right font-mono text-slate-600">{formatNumber(s.delivery_run_count ?? 0)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/dashboard/sales?supermarket_id=${s.id}`}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                          title="View sales"
                        >
                          <ShoppingCart className="w-4 h-4" />
                        </Link>
                        <Link
                          href={`/dashboard/returns?supermarket_id=${s.id}`}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-amber-600"
                          title="View returns"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Link>
                        <Link
                          href={`/dashboard/deliveries?supermarket_id=${s.id}`}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                          title="View deliveries"
                        >
                          <Truck className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={smPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={list.length}
              onPageChange={setSmPage}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Stock at each shop is not live-tracked; it is inferred from imported sales reports, deliveries, and returns.
      </p>
    </div>
  )
}
