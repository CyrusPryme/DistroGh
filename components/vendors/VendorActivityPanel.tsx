'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, Package, Search } from 'lucide-react'
import { DashboardDateRangePicker } from '@/components/dashboard/DashboardDateRangePicker'
import { DashboardSortableTable, type DashboardColumn } from '@/components/dashboard/DashboardSortableTable'
import { KPICard } from '@/components/dashboard/KPICard'
import { DashboardEmptyState } from '@/components/dashboard/DashboardEmptyState'
import {
  resolveDashboardDateRange,
  type DashboardDatePreset,
  type DashboardDateRange,
} from '@/lib/dashboard-date-range'
import { formatNumber, cn } from '@/lib/utils'
import { vendorActivityService } from '@/services/vendor-activity.service'
import { VendorActivityProductsModal } from '@/components/vendors/VendorActivityProductsModal'
import type { VendorActivityRow } from '@/lib/vendor-activity'
import type { Vendor } from '@/types'

type VendorActivityPanelProps = {
  mode: 'admin' | 'vendor'
  vendors?: Vendor[]
  vendorsLoading?: boolean
}

function sumRows(rows: VendorActivityRow[], key: keyof VendorActivityRow): number {
  return rows.reduce((s, r) => s + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0)
}

export function VendorActivityPanel({ mode, vendors = [], vendorsLoading }: VendorActivityPanelProps) {
  const [preset, setPreset] = useState<DashboardDatePreset>('last_8_weeks')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [vendorSearch, setVendorSearch] = useState('')
  const [rows, setRows] = useState<VendorActivityRow[]>([])
  const [soldSettledOnly, setSoldSettledOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [productModalVendor, setProductModalVendor] = useState<VendorActivityRow | null>(null)

  const range: DashboardDateRange = useMemo(
    () => resolveDashboardDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  )

  const activeVendors = useMemo(
    () => vendors.filter((v) => !v.deleted_at).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [vendors]
  )

  const filteredVendorOptions = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase()
    if (!q) return activeVendors
    return activeVendors.filter((v) => (v.name ?? '').toLowerCase().includes(q))
  }, [activeVendors, vendorSearch])

  const load = useCallback(async () => {
    if (mode === 'admin' && selectedIds.size === 0) {
      setRows([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const from = range.from || undefined
      const to = range.to || undefined
      const res = await vendorActivityService.getSummary({
        vendorIds: mode === 'admin' ? Array.from(selectedIds) : undefined,
        from,
        to,
      })
      setRows(res.vendors)
      setSoldSettledOnly(res.sold_counts_settled_only)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [mode, selectedIds, range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  const toggleVendor = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const v of filteredVendorOptions) {
        if (v.id) next.add(v.id)
      }
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const totals = useMemo(
    () => ({
      received: sumRows(rows, 'received'),
      delivered: sumRows(rows, 'delivered'),
      sold: sumRows(rows, 'sold'),
      returns: sumRows(rows, 'returns'),
      warehouse_on_hand: sumRows(rows, 'warehouse_on_hand'),
    }),
    [rows]
  )

  const showTotalsRow = mode === 'admin' && rows.length > 1

  const openProductBreakdown = useCallback((row: VendorActivityRow) => {
    setProductModalVendor(row)
  }, [])

  const columns: DashboardColumn<VendorActivityRow>[] = useMemo(
    () => [
      ...(mode === 'admin'
        ? [
            {
              key: 'vendor',
              header: 'Vendor',
              sortable: true,
              sortValue: (r: VendorActivityRow) => r.vendor_name,
              render: (r: VendorActivityRow) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openProductBreakdown(r)
                  }}
                  className="font-medium text-brand-700 hover:underline text-left"
                >
                  {r.vendor_name}
                </button>
              ),
            } satisfies DashboardColumn<VendorActivityRow>,
          ]
        : []),
      {
        key: 'received',
        header: 'Received',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.received,
        render: (r) => formatNumber(r.received),
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.delivered,
        render: (r) => formatNumber(r.delivered),
      },
      {
        key: 'sold',
        header: 'Sold (units)',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.sold,
        render: (r) => formatNumber(r.sold),
      },
      {
        key: 'returns',
        header: 'Returns',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.returns,
        render: (r) => formatNumber(r.returns),
      },
      {
        key: 'warehouse_on_hand',
        header: 'WH on hand',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.warehouse_on_hand,
        render: (r) => (
          <span title="All-time warehouse stock (not limited by period)">{formatNumber(r.warehouse_on_hand)}</span>
        ),
      },
    ],
    [mode, openProductBreakdown]
  )

  const singleRow = mode === 'vendor' && rows.length === 1 ? rows[0] : null

  return (
    <div className="space-y-6">
      <DashboardDateRangePicker
        value={range}
        customFrom={customFrom}
        customTo={customTo}
        onPresetChange={setPreset}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      {mode === 'admin' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Vendors</h2>
              <p className="text-xs text-slate-500">Select one or more vendors to compare period activity.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFiltered}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
              >
                Select visible
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="Search vendors…"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-100">
            {vendorsLoading ? (
              <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading vendors…
              </p>
            ) : filteredVendorOptions.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No vendors match your search.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredVendorOptions.map((v) => {
                  const id = v.id!
                  const checked = selectedIds.has(id)
                  return (
                    <li key={id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50',
                          checked && 'bg-brand-50/50'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleVendor(id)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600"
                        />
                        <span className="font-medium text-slate-800">{v.name}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {selectedIds.size === 0
              ? 'Choose at least one vendor to load metrics.'
              : `${selectedIds.size} vendor${selectedIds.size === 1 ? '' : 's'} selected`}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading activity…
        </div>
      ) : mode === 'admin' && selectedIds.size === 0 ? (
        <DashboardEmptyState
          icon={Package}
          title="Select vendors"
          description="Pick one or more vendors above to see received, delivered, sold, and return totals for the period."
        />
      ) : rows.length === 0 && !loading ? (
        <DashboardEmptyState
          icon={Package}
          title="No data"
          description="No activity found for the selected vendors and period."
        />
      ) : (
        <>
          {singleRow ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <KPICard title="Received" value={singleRow.received} icon={Package} compact />
              <KPICard title="Delivered" value={singleRow.delivered} icon={Package} compact />
              <KPICard title="Sold (units)" value={singleRow.sold} icon={Package} compact />
              <KPICard title="Returns" value={singleRow.returns} icon={Package} compact />
              <KPICard
                title="WH on hand"
                value={singleRow.warehouse_on_hand}
                subtitle="All time"
                icon={Package}
                compact
              />
            </div>
          ) : null}

          <p className="text-xs text-slate-500">
            Period: {range.label}. Received and delivered use intake and delivery dates; sold uses sales weeks
            overlapping the period
            {soldSettledOnly ? ' (settled sales only).' : '.'} Warehouse on hand is all-time stock still at DistroGH.
            {mode === 'admin' && rows.length > 0 ? ' Click a vendor row for a product breakdown.' : null}
          </p>

          {mode === 'vendor' && singleRow ? (
            <button
              type="button"
              onClick={() => openProductBreakdown(singleRow)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              View by product
            </button>
          ) : null}

          {!(mode === 'vendor' && rows.length === 1) ? (
            <DashboardSortableTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.vendor_id}
              onRowClick={mode === 'admin' ? openProductBreakdown : undefined}
            />
          ) : null}

          {showTotalsRow ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <span className="font-semibold text-slate-800">Combined totals — </span>
              <span className="text-slate-600">
                Received {formatNumber(totals.received)}, Delivered {formatNumber(totals.delivered)}, Sold{' '}
                {formatNumber(totals.sold)}, Returns {formatNumber(totals.returns)}, WH on hand{' '}
                {formatNumber(totals.warehouse_on_hand)}
              </span>
            </div>
          ) : null}
        </>
      )}

      {productModalVendor ? (
        <VendorActivityProductsModal
          open={!!productModalVendor}
          onClose={() => setProductModalVendor(null)}
          vendorId={productModalVendor.vendor_id}
          vendorName={productModalVendor.vendor_name}
          periodLabel={range.label}
          from={range.from || undefined}
          to={range.to || undefined}
          showVendorProfileLink={mode === 'admin'}
        />
      ) : null}
    </div>
  )
}
