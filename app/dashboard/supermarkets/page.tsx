'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Building2, ShoppingCart, RotateCcw, Truck, Loader2, AlertCircle, Plus, Edit2 } from 'lucide-react'
import { supermarketService, type SupermarketSummary } from '@/services/supermarket.service'
import { SupermarketModal } from '@/components/supermarkets/SupermarketModal'
import { useSession } from '@/hooks/useSession'
import { formatGHS, formatNumber } from '@/lib/utils'
import { formatSupermarketLabel } from '@/lib/supermarket-display'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import type { Supermarket } from '@/types'
import type { SupermarketFormValues } from '@/lib/validations'

export default function SupermarketsPage() {
  const { role } = useSession({ redirectVendorFromAdmin: true })
  const isAdmin = role === 'admin'
  const [list, setList] = useState<SupermarketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [smPage, setSmPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editSupermarket, setEditSupermarket] = useState<Supermarket | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = async () => {
    try {
      const data = await supermarketService.getSummaries().catch(() => [])
      setList(Array.isArray(data) ? data : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load supermarkets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const paginatedList = useMemo(
    () => getPageSlice(list, smPage, DEFAULT_PAGE_SIZE),
    [list, smPage]
  )

  const handleSubmit = async (data: SupermarketFormValues) => {
    setSubmitting(true)
    try {
      const payload = {
        name: data.name.trim(),
        location: data.location.trim(),
        branch: data.branch?.trim() || null,
        store_code: data.store_code?.trim() || null,
      }
      if (editSupermarket) {
        await supermarketService.update(editSupermarket.id, payload)
        setToast('Supermarket updated')
      } else {
        await supermarketService.create(payload)
        setToast('Supermarket added')
      }
      setModalOpen(false)
      setEditSupermarket(null)
      await load()
      setTimeout(() => setToast(null), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save supermarket')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="page-container space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Supermarkets</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Retailer outlets you distribute to. Add a branch for chains with multiple locations.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => { setEditSupermarket(null); setModalOpen(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" />
            Add supermarket
          </button>
        )}
      </div>

      {toast && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          {toast}
        </div>
      )}

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
          <p className="text-slate-500 text-sm mt-1">
            Add retailer outlets with branch names for multi-location chains.
          </p>
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Retailer</th>
                  <th>Branch</th>
                  <th>Store code</th>
                  <th>Location</th>
                  <th className="text-right">Total sales</th>
                  <th className="text-right">Sales entries</th>
                  <th className="text-right">Returns</th>
                  <th className="text-right">Deliveries</th>
                  <th className="w-24" />
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
                    <td className="text-slate-600 text-sm">{s.branch?.trim() || '—'}</td>
                    <td className="text-slate-600 text-sm font-mono">{s.store_code?.trim() || '—'}</td>
                    <td className="text-slate-600 text-sm">{s.location || '—'}</td>
                    <td className="text-right font-mono font-semibold text-slate-800">{formatGHS(s.total_sales ?? 0)}</td>
                    <td className="text-right font-mono text-slate-600">{formatNumber(s.sales_count ?? 0)}</td>
                    <td className="text-right font-mono text-slate-600">{formatNumber(s.return_count ?? 0)}</td>
                    <td className="text-right font-mono text-slate-600">{formatNumber(s.delivery_run_count ?? 0)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => { setEditSupermarket(s); setModalOpen(true) }}
                            className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        <Link
                          href={`/dashboard/sales?supermarket_id=${s.id}`}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                          title={`View sales — ${formatSupermarketLabel(s)}`}
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
        Sales imports match spreadsheet BRANCH and store columns to these records. Single-location shops can leave branch blank.
      </p>

      <SupermarketModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditSupermarket(null) }}
        onSubmit={handleSubmit}
        initialData={editSupermarket}
        isSubmitting={submitting}
      />
    </div>
  )
}
