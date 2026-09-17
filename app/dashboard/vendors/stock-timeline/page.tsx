'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, CalendarRange, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DashboardDateRangePicker } from '@/components/dashboard/DashboardDateRangePicker'
import { DashboardSortableTable, type DashboardColumn } from '@/components/dashboard/DashboardSortableTable'
import { KPICard } from '@/components/dashboard/KPICard'
import {
  resolveDashboardDateRange,
  type DashboardDatePreset,
} from '@/lib/dashboard-date-range'
import { formatNumber, cn } from '@/lib/utils'
import { vendorService } from '@/services/vendor.service'
import { productService } from '@/services/product.service'
import { vendorStockTimelineService } from '@/services/vendor-stock-timeline.service'
import type { StockTimelineEvent } from '@/lib/vendor-stock-timeline'
import type { Vendor, Product } from '@/types'
import { useSession } from '@/hooks/useSession'

const KIND_LABEL: Record<StockTimelineEvent['kind'], string> = {
  intake: 'Received',
  delivery: 'Delivered',
  sale: 'Sold',
  return: 'Return',
}

const KIND_CLASS: Record<StockTimelineEvent['kind'], string> = {
  intake: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  delivery: 'bg-blue-50 text-blue-800 ring-blue-200',
  sale: 'bg-violet-50 text-violet-800 ring-violet-200',
  return: 'bg-amber-50 text-amber-800 ring-amber-200',
}

function VendorStockTimelineContent() {
  useSession({ redirectVendorFromAdmin: true })
  const searchParams = useSearchParams()

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState(() => searchParams.get('vendor_id') ?? '')
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState(() => searchParams.get('product_id') ?? '')
  const [preset, setPreset] = useState<DashboardDatePreset>('all_time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<StockTimelineEvent[]>([])
  const [summary, setSummary] = useState<{
    received: number
    delivered: number
    sold: number
    returns: number
    warehouse_on_hand: number
    delivery_minus_sold_plus_returns: number
  } | null>(null)
  const [productLabel, setProductLabel] = useState('')

  const range = useMemo(
    () => resolveDashboardDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  )

  useEffect(() => {
    vendorService
      .getAll()
      .then((v) => setVendors(v.filter((x) => !x.deleted_at)))
      .catch(() => setVendors([]))
  }, [])

  useEffect(() => {
    if (!vendorId) {
      setProducts([])
      setProductId('')
      return
    }
    productService
      .getByVendor(vendorId)
      .then(setProducts)
      .catch(() => setProducts([]))
  }, [vendorId])

  const load = useCallback(async () => {
    if (!productId) {
      setEvents([])
      setSummary(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await vendorStockTimelineService.get({
        productId,
        from: range.from || undefined,
        to: range.to || undefined,
      })
      setEvents(res.events)
      setSummary(res.summary)
      setProductLabel(`${res.vendor_name} — ${res.product_name}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline')
      setEvents([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [productId, range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  const columns: DashboardColumn<StockTimelineEvent>[] = useMemo(
    () => [
      {
        key: 'kind',
        header: 'Type',
        sortable: true,
        sortValue: (r) => r.kind,
        render: (r) => (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium ring-1', KIND_CLASS[r.kind])}>
            {KIND_LABEL[r.kind]}
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Date / week',
        sortable: true,
        sortValue: (r) => r.sort_date,
        render: (r) =>
          r.kind === 'sale' && r.end_date ? (
            <span>
              {r.sort_date} → {r.end_date}
            </span>
          ) : (
            r.sort_date
          ),
      },
      {
        key: 'qty',
        header: 'Units',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.quantity,
        render: (r) => formatNumber(r.quantity),
      },
      {
        key: 'dest',
        header: 'Where',
        sortable: true,
        sortValue: (r) => r.destination ?? '',
        render: (r) => r.destination ?? '—',
      },
      {
        key: 'ref',
        header: 'Notes',
        render: (r) => <span className="text-xs text-slate-500">{r.reference ?? '—'}</span>,
      },
    ],
    []
  )

  const gap = summary?.delivery_minus_sold_plus_returns ?? 0

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Stock timeline"
        description="Line-by-line intakes, delivery runs, and sales weeks for one product — compare dates when delivered vs sold totals disagree."
        icon={<CalendarRange className="h-7 w-7 text-brand-600" />}
        actions={
          <Link
            href="/dashboard/vendors/activity"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            Vendor flow
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Vendor</span>
          <select
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value)
              setProductId('')
            }}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Product</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={!vendorId}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DashboardDateRangePicker
        value={range}
        customFrom={customFrom}
        customTo={customTo}
        onPresetChange={setPreset}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      <p className="text-xs text-slate-500">
        Use <strong>All time</strong> to include legacy or mis-dated rows outside normal operating dates. WH on hand is
        always all-time warehouse stock. Store gap = delivered − sold + returns for the selected period.
      </p>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {!productId ? (
        <p className="text-sm text-slate-500">Choose a vendor and product to load the timeline.</p>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : summary ? (
        <>
          <p className="text-sm font-medium text-slate-800">{productLabel}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <KPICard title="Received" value={summary.received} icon={CalendarRange} compact />
            <KPICard title="Delivered" value={summary.delivered} icon={CalendarRange} compact />
            <KPICard title="Sold" value={summary.sold} icon={CalendarRange} compact />
            <KPICard title="Returns" value={summary.returns} icon={CalendarRange} compact />
            <KPICard title="WH on hand" value={summary.warehouse_on_hand} subtitle="All time" icon={CalendarRange} compact />
            <KPICard
              title="Del − sold + ret"
              value={gap}
              subtitle={gap < 0 ? 'Oversold vs deliveries' : gap > 0 ? 'Surplus deliveries' : 'Balanced'}
              icon={CalendarRange}
              compact
            />
          </div>
          <DashboardSortableTable columns={columns} rows={events} rowKey={(r) => `${r.kind}-${r.record_id}`} />
        </>
      ) : null}
    </div>
  )
}

export default function VendorStockTimelinePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading…</div>}>
      <VendorStockTimelineContent />
    </Suspense>
  )
}
