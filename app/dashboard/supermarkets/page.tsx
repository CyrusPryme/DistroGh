'use client'

import { useEffect, useState, useMemo } from 'react'
import { Building2, ShoppingCart, RotateCcw, Truck, Loader2, AlertCircle, Plus, Edit2 } from 'lucide-react'
import { supermarketService, type SupermarketSummary } from '@/services/supermarket.service'
import { SupermarketModal } from '@/components/supermarkets/SupermarketModal'
import { useSession } from '@/hooks/useSession'
import { formatGHS, formatNumber } from '@/lib/utils'
import { formatSupermarketLabel } from '@/lib/supermarket-display'
import { formatDisplayName } from '@/lib/format-display-name'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { SearchInput } from '@/components/shared/SearchInput'
import { ListToolbar, DataTableShell } from '@/components/shared/DataTableShell'
import { IconAction } from '@/components/shared/IconAction'
import { KPICard } from '@/components/dashboard/KPICard'
import { useToast } from '@/hooks/useToast'
import { usePageSize } from '@/hooks/usePageSize'
import type { Supermarket } from '@/types'
import type { SupermarketFormValues } from '@/lib/validations'

export default function SupermarketsPage() {
  const { role } = useSession({ redirectVendorFromAdmin: true })
  const isAdmin = role === 'admin'
  const [list, setList] = useState<SupermarketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [smPage, setSmPage] = useState(1)
  const [smPageSize, setSmPageSize] = usePageSize('supermarkets', DEFAULT_PAGE_SIZE)
  const [modalOpen, setModalOpen] = useState(false)
  const [editSupermarket, setEditSupermarket] = useState<Supermarket | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const { toast, showToast, dismissToast } = useToast(3000)

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((s) =>
      [s.name, s.branch, s.location, s.store_code].some((v) => (v ?? '').toLowerCase().includes(q))
    )
  }, [list, search])

  useEffect(() => {
    setSmPage(1)
  }, [search])

  const paginatedList = useMemo(
    () => getPageSlice(filtered, smPage, smPageSize),
    [filtered, smPage, smPageSize]
  )

  const totalSales = useMemo(() => list.reduce((sum, s) => sum + Number(s.total_sales ?? 0), 0), [list])
  const totalDeliveries = useMemo(() => list.reduce((sum, s) => sum + Number(s.delivery_run_count ?? 0), 0), [list])

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
        showToast('Supermarket updated')
      } else {
        await supermarketService.create(payload)
        showToast('Supermarket added')
      }
      setModalOpen(false)
      setEditSupermarket(null)
      await load()
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
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={dismissToast} />

      <PageHeader
        title="Supermarkets"
        description="Retailer outlets you distribute to. Add a branch for chains with multiple locations."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard compact title="Outlets" value={list.length} icon={Building2} iconBg="bg-blue-50" iconColor="text-blue-600" />
        <KPICard compact title="Total sales" value={totalSales} icon={ShoppingCart} iconBg="bg-emerald-50" iconColor="text-emerald-600" isCurrency />
        <KPICard compact title="Delivery runs" value={totalDeliveries} icon={Truck} iconBg="bg-cyan-50" iconColor="text-cyan-600" />
      </div>

      <ListToolbar
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search outlet, branch, location…"
            aria-label="Search supermarkets"
          />
        }
        actions={
          isAdmin ? (
            <button
              type="button"
              onClick={() => {
                setEditSupermarket(null)
                setModalOpen(true)
              }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add supermarket
            </button>
          ) : undefined
        }
      />

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
      ) : filtered.length === 0 ? (
        <div className="data-card text-center py-12">
          <p className="font-semibold text-slate-600">No outlets match search</p>
          <p className="text-slate-400 text-sm mt-1">Try a different name, branch, or location.</p>
        </div>
      ) : (
        <DataTableShell
          pagination={
            <PaginationBar
              page={smPage}
              pageSize={smPageSize}
              totalItems={filtered.length}
              onPageChange={setSmPage}
              onPageSizeChange={setSmPageSize}
            />
          }
        >
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="min-w-[220px]">Retailer</th>
                  <th>Branch</th>
                  <th>Store code</th>
                  <th>Location</th>
                  <th className="min-w-[120px] text-right">Total sales</th>
                  <th className="text-right">Sales entries</th>
                  <th className="text-right">Returns</th>
                  <th className="text-right">Deliveries</th>
                  <th className="text-right min-w-[128px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.map((s) => (
                  <tr key={s.id}>
                    <td className="min-w-[220px] max-w-[280px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-800 truncate" title={s.name}>
                          {formatDisplayName(s.name)}
                        </span>
                      </div>
                    </td>
                    <td className="text-slate-600 text-sm whitespace-nowrap">{s.branch?.trim() || '—'}</td>
                    <td className="text-slate-600 text-sm font-mono tabular-nums">{s.store_code?.trim() || '—'}</td>
                    <td className="text-slate-600 text-sm truncate max-w-[160px]">{s.location || '—'}</td>
                    <td className="text-right tabular-nums font-semibold text-slate-800">{formatGHS(s.total_sales ?? 0)}</td>
                    <td className="text-right tabular-nums text-slate-600">{formatNumber(s.sales_count ?? 0)}</td>
                    <td className="text-right tabular-nums text-slate-600">{formatNumber(s.return_count ?? 0)}</td>
                    <td className="text-right tabular-nums text-slate-600">{formatNumber(s.delivery_run_count ?? 0)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-0.5">
                        {isAdmin && (
                          <IconAction
                            label="Edit"
                            onClick={() => {
                              setEditSupermarket(s)
                              setModalOpen(true)
                            }}
                          >
                            <Edit2 className="h-4 w-4" />
                          </IconAction>
                        )}
                        <IconAction label={`View sales — ${formatSupermarketLabel(s)}`} href={`/dashboard/sales?supermarket_id=${s.id}`}>
                          <ShoppingCart className="h-4 w-4" />
                        </IconAction>
                        <IconAction label="View returns" href={`/dashboard/returns?supermarket_id=${s.id}`}>
                          <RotateCcw className="h-4 w-4" />
                        </IconAction>
                        <IconAction label="View deliveries" href={`/dashboard/deliveries?supermarket_id=${s.id}`}>
                          <Truck className="h-4 w-4" />
                        </IconAction>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </DataTableShell>
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
