'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import {
  Inbox,
  Plus,
  Package,
  Building2,
  Loader2,
  AlertCircle,
  Filter,
  Trash2,
  ClipboardList,
  Warehouse,
  Search,
  X,
  CalendarRange,
} from 'lucide-react'
import { intakeService } from '@/services/intake.service'
import { vendorService } from '@/services/vendor.service'
import { productService } from '@/services/product.service'
import { formatDate, formatNumber, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { DataTableShell } from '@/components/shared/DataTableShell'
import { formatDisplayName } from '@/lib/format-display-name'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { useSession } from '@/hooks/useSession'
import { useToast } from '@/hooks/useToast'
import { usePageSize } from '@/hooks/usePageSize'
import { IntakeReferenceBadge } from '@/components/receiving/IntakeReferenceBadge'
import { DiscrepancyHintIcon } from '@/components/receiving/DiscrepancyHintIcon'
import { ReceivingViewTabs, type ReceivingViewTab } from '@/components/receiving/ReceivingViewTabs'
import { ReceivingTableSkeleton } from '@/components/receiving/ReceivingTableSkeleton'
import {
  getWarehouseStockDiscrepancy,
  intakeRowDiscrepancyTooltip,
  intakeRowHasDiscrepancyHint,
} from '@/lib/intake-reference-display'
import {
  formatReceivingDateRangeLabel,
  productMatchesSearch,
  receivingLogEmptyMessage,
  receivingStockEmptyMessage,
} from '@/lib/receiving-filters'
import type { Intake, Vendor, Product } from '@/types'

type StockRow = {
  product_id: string
  product_name: string
  received: number
  delivered: number
  on_hand: number
}

export default function ReceivingPage() {
  const [intakes, setIntakes] = useState<Intake[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [logRefreshing, setLogRefreshing] = useState(false)
  const [stockRefreshing, setStockRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterVendor, setFilterVendor] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [stockSearch, setStockSearch] = useState('')
  const [activeTab, setActiveTab] = useState<ReceivingViewTab>('log')
  const { toast, showToast, dismissToast } = useToast(3500)
  const { role, vendorId, loading: sessionLoading } = useSession({ requireAuth: true })
  const [stockPage, setStockPage] = useState(1)
  const [stockPageSize, setStockPageSize] = usePageSize('receiving-stock', DEFAULT_PAGE_SIZE)
  const [intakePage, setIntakePage] = useState(1)
  const [intakePageSize, setIntakePageSize] = usePageSize('receiving-intakes', DEFAULT_PAGE_SIZE)

  const isVendor = role === 'vendor' && vendorId

  const effectiveVendorId = isVendor ? vendorId! : filterVendor || undefined

  const [form, setForm] = useState<{
    vendor_id: string
    received_date: string
    reference: string
    items: { product_id: string; quantity_received: number }[]
  }>({
    vendor_id: '',
    received_date: new Date().toISOString().slice(0, 10),
    reference: '',
    items: [{ product_id: '', quantity_received: 1 }],
  })

  const selectedVendorName = useMemo(() => {
    if (isVendor) return null
    if (!filterVendor) return null
    return vendors.find((v) => v.id === filterVendor)?.name ?? null
  }, [isVendor, filterVendor, vendors])

  const hasDateFilter = Boolean(filterFrom || filterTo)
  const hasVendorFilter = Boolean(!isVendor && filterVendor)
  const hasStockSearch = Boolean(stockSearch.trim())
  const dateRangeLabel = formatReceivingDateRangeLabel(filterFrom, filterTo)

  const loadCatalog = useCallback(async () => {
    if (isVendor) return
    const [v, p] = await Promise.all([vendorService.getAll(), productService.getAll()])
    setVendors(Array.isArray(v) ? v : [])
    setProducts(Array.isArray(p) ? p : [])
  }, [isVendor])

  const loadIntakes = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (sessionLoading || role === null) return
      if (role === 'vendor' && !vendorId) return
      if (!opts?.silent) setLogRefreshing(true)
      try {
        const rows = await intakeService.getAll({
          vendor_id: effectiveVendorId,
          from: filterFrom || undefined,
          to: filterTo || undefined,
        })
        setIntakes(Array.isArray(rows) ? rows : [])
        setError(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load receipt log')
      } finally {
        setLogRefreshing(false)
      }
    },
    [sessionLoading, role, vendorId, effectiveVendorId, filterFrom, filterTo]
  )

  const loadStock = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (sessionLoading || role === null) return
      if (role === 'vendor' && !vendorId) return
      if (!opts?.silent) setStockRefreshing(true)
      try {
        const rows = await intakeService.getStockByProduct(effectiveVendorId)
        setStock(Array.isArray(rows) ? rows : [])
        setError(null)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load stock summary')
      } finally {
        setStockRefreshing(false)
      }
    },
    [sessionLoading, role, vendorId, effectiveVendorId]
  )

  useEffect(() => {
    if (sessionLoading || role === null) return
    if (role === 'vendor' && !vendorId) return

    let cancelled = false
    ;(async () => {
      setInitialLoading(true)
      try {
        await Promise.all([loadCatalog(), loadIntakes({ silent: true }), loadStock({ silent: true })])
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionLoading, role, vendorId])

  useEffect(() => {
    if (initialLoading) return
    loadIntakes()
  }, [effectiveVendorId, filterFrom, filterTo, initialLoading, loadIntakes])

  useEffect(() => {
    if (initialLoading) return
    loadStock()
  }, [effectiveVendorId, initialLoading, loadStock])

  useEffect(() => {
    setStockPage(1)
    setIntakePage(1)
  }, [filterVendor, filterFrom, filterTo, stockSearch, role, vendorId])

  const filteredStock = useMemo(
    () => stock.filter((row) => productMatchesSearch(row.product_name, stockSearch)),
    [stock, stockSearch]
  )

  const stockByProductId = useMemo(() => {
    const map = new Map<string, StockRow>()
    for (const row of stock) map.set(row.product_id, row)
    return map
  }, [stock])

  const paginatedStock = useMemo(
    () => getPageSlice(filteredStock, stockPage, stockPageSize),
    [filteredStock, stockPage, stockPageSize]
  )
  const paginatedIntakes = useMemo(
    () => getPageSlice(intakes, intakePage, intakePageSize),
    [intakes, intakePage, intakePageSize]
  )

  const productsForVendor = form.vendor_id
    ? products.filter((p) => p.vendor_id === form.vendor_id)
    : products

  const clearFilters = () => {
    setFilterVendor('')
    setFilterFrom('')
    setFilterTo('')
    setStockSearch('')
  }

  const filtersActive = hasVendorFilter || hasDateFilter || hasStockSearch

  const tabOptions = useMemo(
    () => [
      {
        key: 'log' as const,
        label: 'Receipt log',
        icon: ClipboardList,
        count: intakes.length,
        filtersActive: hasVendorFilter || hasDateFilter,
      },
      {
        key: 'stock' as const,
        label: 'Current on-hand stock summary',
        icon: Warehouse,
        count: filteredStock.length,
        totalCount: stock.length,
        filtersActive: hasVendorFilter || hasStockSearch,
      },
    ],
    [intakes.length, filteredStock.length, stock.length, hasVendorFilter, hasDateFilter, hasStockSearch]
  )

  const logEmpty = receivingLogEmptyMessage({
    isVendor: Boolean(isVendor),
    vendorName: selectedVendorName,
    hasVendorFilter,
    hasDateFilter,
    dateRangeLabel,
  })

  const stockEmpty = receivingStockEmptyMessage({
    isVendor: Boolean(isVendor),
    vendorName: selectedVendorName,
    hasVendorFilter,
    hasProductSearch: hasStockSearch,
    productSearch: stockSearch,
  })

  const addRow = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { product_id: '', quantity_received: 1 }] }))
  }

  const removeRow = (index: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : prev.items,
    }))
  }

  const updateItem = (index: number, field: 'product_id' | 'quantity_received', value: string | number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, [field]: field === 'quantity_received' ? Number(value) || 1 : value } : item
      ),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validItems = form.items.filter((it) => it.product_id && it.quantity_received >= 1)
    if (!form.vendor_id || validItems.length === 0) {
      showToast('Select vendor and at least one product with quantity ≥ 1.', 'error')
      return
    }
    setSubmitting(true)
    try {
      await intakeService.bulkCreate(
        validItems.map((it) => ({
          vendor_id: form.vendor_id,
          product_id: it.product_id,
          quantity_received: it.quantity_received,
          received_date: form.received_date,
          reference: form.reference?.trim() || undefined,
        }))
      )
      showToast(`${validItems.length} intake(s) recorded.`)
      setModalOpen(false)
      setForm({
        vendor_id: '',
        received_date: new Date().toISOString().slice(0, 10),
        reference: '',
        items: [{ product_id: '', quantity_received: 1 }],
      })
      await Promise.all([loadIntakes(), loadStock()])
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to record intake', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const sessionPending = initialLoading || sessionLoading || role === null || (role === 'vendor' && !vendorId)
  const logColumns = isVendor ? 5 : 6
  const showLogSkeleton = sessionPending || logRefreshing
  const showStockSkeleton = sessionPending || stockRefreshing

  return (
    <div className="page-container">
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={dismissToast} />

      <PageHeader
        title="Receiving"
        description={
          isVendor
            ? 'When your products were received at DistroGH and current stock on hand (read-only).'
            : 'Confirm and record stock received at DistroGH from vendors before sending to supermarkets.'
        }
        actions={
          !isVendor ? (
            <button type="button" onClick={() => setModalOpen(true)} className="btn-primary">
              <Plus className="w-4 h-4" />
              Record intake
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
        <Filter className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
        {!isVendor && (
          <select
            value={filterVendor}
            onChange={(e) => setFilterVendor(e.target.value)}
            className="form-input w-48"
            aria-label="Filter by vendor"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        ) : null}
        <span className="text-xs text-slate-500 ml-auto hidden md:inline">
          Vendor filter applies to both tabs. Date range applies to receipt log only.
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="data-card overflow-hidden p-0">
        <ReceivingViewTabs value={activeTab} onChange={setActiveTab} options={tabOptions} />

        <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
          {activeTab === 'log' ? (
            <div className="flex flex-wrap items-center gap-3">
              <CalendarRange className="h-4 w-4 text-slate-400 shrink-0" aria-hidden />
              <label className="sr-only" htmlFor="receiving-from">
                From date
              </label>
              <input
                id="receiving-from"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="form-input w-40 bg-white"
              />
              <span className="text-slate-400 text-sm">to</span>
              <label className="sr-only" htmlFor="receiving-to">
                To date
              </label>
              <input
                id="receiving-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="form-input w-40 bg-white"
              />
              <p className="text-xs text-slate-500 w-full sm:w-auto">
                Filters receipt entries by received date. Stock summary uses all-time totals.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Filter products…"
                  className="form-input w-full pl-9 bg-white"
                  aria-label="Filter products"
                />
              </div>
              {hasStockSearch ? (
                <button
                  type="button"
                  onClick={() => setStockSearch('')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear search
                </button>
              ) : null}
              <p className="text-xs text-slate-500 w-full sm:w-auto sm:ml-auto">
                All-time warehouse balance per product (received minus delivered).
              </p>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5" role="tabpanel">
          {activeTab === 'log' ? (
            showLogSkeleton ? (
              <ReceivingTableSkeleton columns={logColumns} />
            ) : intakes.length === 0 ? (
              <div className="text-center py-12">
                <Inbox className="w-14 h-14 text-slate-300 mx-auto mb-4" />
                <h3 className="font-display text-lg font-semibold text-slate-600">{logEmpty.title}</h3>
                <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">{logEmpty.description}</p>
                {!isVendor && !hasVendorFilter && !hasDateFilter && (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
                  >
                    <Plus className="w-4 h-4" />
                    Record intake
                  </button>
                )}
              </div>
            ) : (
              <DataTableShell
                pagination={
                  <PaginationBar
                    page={intakePage}
                    pageSize={intakePageSize}
                    totalItems={intakes.length}
                    onPageChange={setIntakePage}
                    onPageSizeChange={setIntakePageSize}
                  />
                }
              >
                <table className="data-table min-w-[720px]">
                  <thead>
                    <tr>
                      {!isVendor && <th className="min-w-[160px]">Vendor</th>}
                      <th className="min-w-[220px]">Product</th>
                      <th className="text-right">Qty</th>
                      <th className="min-w-[120px]">Reference</th>
                      <th>Received date</th>
                      <th className="w-10" aria-label="Notes" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedIntakes.map((r) => {
                      const stockRow = stockByProductId.get(r.product_id)
                      const stockDiscrepancy = stockRow
                        ? getWarehouseStockDiscrepancy(stockRow.received, stockRow.delivered)
                        : null
                      const hint = intakeRowDiscrepancyTooltip(r.reference, stockDiscrepancy)
                      const showHint = intakeRowHasDiscrepancyHint(r.reference, stockDiscrepancy)

                      return (
                        <tr key={r.id}>
                          {!isVendor && (
                            <td className="min-w-[160px]">
                              <div className="flex items-center gap-2 min-w-0">
                                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                                <span className="text-slate-800 truncate">
                                  {formatDisplayName((r.vendor as { name?: string })?.name)}
                                </span>
                              </div>
                            </td>
                          )}
                          <td className="min-w-[220px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <Package className="w-4 h-4 text-slate-400 shrink-0" />
                              <span className="font-semibold text-slate-800 truncate">
                                {formatDisplayName((r.product as { name?: string })?.name)}
                              </span>
                            </div>
                          </td>
                          <td className="text-right tabular-nums">{r.quantity_received}</td>
                          <td>
                            <IntakeReferenceBadge reference={r.reference} />
                          </td>
                          <td className="text-slate-600 whitespace-nowrap">{formatDate(r.received_date)}</td>
                          <td className="text-center">
                            {showHint && hint ? <DiscrepancyHintIcon message={hint} /> : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </DataTableShell>
            )
          ) : showStockSkeleton ? (
            <ReceivingTableSkeleton columns={5} />
          ) : filteredStock.length === 0 ? (
            <div className="text-center py-12">
              <Warehouse className="w-14 h-14 text-slate-300 mx-auto mb-4" />
              <h3 className="font-display text-lg font-semibold text-slate-600">{stockEmpty.title}</h3>
              <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">{stockEmpty.description}</p>
            </div>
          ) : (
            <DataTableShell
              pagination={
                <PaginationBar
                  page={stockPage}
                  pageSize={stockPageSize}
                  totalItems={filteredStock.length}
                  onPageChange={setStockPage}
                  onPageSizeChange={setStockPageSize}
                />
              }
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="min-w-[220px]">Product</th>
                    <th className="text-right">Received</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">On hand</th>
                    <th className="w-10" aria-label="Notes" />
                  </tr>
                </thead>
                <tbody>
                  {paginatedStock.map((row) => {
                    const discrepancy = getWarehouseStockDiscrepancy(row.received, row.delivered)
                    return (
                      <tr key={row.product_id}>
                        <td className="min-w-[220px] font-semibold text-slate-800 truncate">
                          {formatDisplayName(row.product_name)}
                        </td>
                        <td className="text-right tabular-nums">{formatNumber(row.received)}</td>
                        <td className="text-right tabular-nums">{formatNumber(row.delivered)}</td>
                        <td className="text-right tabular-nums font-semibold text-brand-700">
                          {formatNumber(row.on_hand)}
                        </td>
                        <td className="text-center">
                          {discrepancy ? <DiscrepancyHintIcon message={discrepancy.message} /> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </DataTableShell>
          )}
        </div>
      </div>

      <FormModal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title="Record intake"
        description="Stock received at DistroGH from vendor. Add multiple products from one vendor."
        maxWidthClass="max-w-xl"
        disableBackdropClose={submitting}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <FormModalBody>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Vendor *</label>
              <select
                value={form.vendor_id}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    vendor_id: e.target.value,
                    items: [{ product_id: '', quantity_received: 1 }],
                  }))
                }
                className="form-input"
                required
              >
                <option value="">Select vendor...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">Products *</label>
                <button
                  type="button"
                  onClick={addRow}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Add product
                </button>
              </div>
              <div className="space-y-3">
                {form.items.map((item, i) => (
                  <div key={i} className="flex gap-2 items-end">
                    <div className="flex-1 min-w-0">
                      <select
                        value={item.product_id}
                        onChange={(e) => updateItem(i, 'product_id', e.target.value)}
                        className="form-input text-sm"
                      >
                        <option value="">Select product...</option>
                        {productsForVendor.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-24 shrink-0">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity_received}
                        onChange={(e) => updateItem(i, 'quantity_received', e.target.value)}
                        className="form-input text-sm"
                        placeholder="Qty"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                      title="Remove row"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reference (optional)</label>
              <input
                type="text"
                value={form.reference ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                className="form-input"
                placeholder="e.g. PO number, batch"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Received date *</label>
              <input
                type="date"
                value={form.received_date ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, received_date: e.target.value }))}
                className="form-input"
              />
            </div>
          </FormModalBody>
          <FormModalFooter>
            <button
              type="button"
              onClick={() => !submitting && setModalOpen(false)}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700',
                'flex items-center justify-center gap-2 disabled:opacity-60'
              )}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Record {form.items.filter((i) => i.product_id && i.quantity_received >= 1).length || 0} intake(s)
            </button>
          </FormModalFooter>
        </form>
      </FormModal>
    </div>
  )
}
