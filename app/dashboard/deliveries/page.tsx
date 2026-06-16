'use client'

import { useEffect, useState, Suspense, useMemo, Fragment, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Truck,
  Plus,
  Package,
  Building2,
  Calendar,
  Loader2,
  AlertCircle,
  Filter,
  CheckCircle2,
  Clock,
  RefreshCw,
} from 'lucide-react'
import { deliveryService, type CreateDeliveryRunPayload } from '@/services/delivery.service'
import { intakeService } from '@/services/intake.service'
import { supermarketService } from '@/services/supermarket.service'
import { productService } from '@/services/product.service'
import { vendorService } from '@/services/vendor.service'
import { formatGHS, formatDate, formatNumber, cn, roundMoney } from '@/lib/utils'
import { formatSupermarketLabel } from '@/lib/supermarket-display'
import {
  allocateTransportCostByQuantity,
  allocationSharesFromAmounts,
  sumAllocationAmounts,
} from '@/lib/delivery-cost-allocation'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { PageToast } from '@/components/shared/PageToast'
import type { DeliveryRun, DeliveryRunVendorCharge, Supermarket, Product, Vendor } from '@/types'

type RunItemRow = { product_id: string; quantity_delivered: number }

function VendorChargeTable({ charges, totalCost }: { charges: DeliveryRunVendorCharge[]; totalCost: number }) {
  if (!charges.length) {
    return (
      <p className="text-xs text-slate-500">
        {totalCost > 0 ? 'No vendor lines to allocate (add products with quantity).' : 'No transport cost on this run.'}
      </p>
    )
  }
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
      <table className="w-full">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Vendor</th>
            <th className="text-right px-3 py-2 font-medium">Units</th>
            <th className="text-right px-3 py-2 font-medium">Share</th>
            <th className="text-right px-3 py-2 font-medium">Charge</th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={c.vendor_id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-800">{c.vendor_name}</td>
              <td className="px-3 py-2 text-right font-mono">{formatNumber(c.quantity_delivered)}</td>
              <td className="px-3 py-2 text-right">{c.share_percent.toFixed(1)}%</td>
              <td className="px-3 py-2 text-right font-mono font-semibold text-amber-800">{formatGHS(c.allocated_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 bg-slate-50 text-slate-500 border-t border-slate-100">
        Shared vehicle cost split by units delivered. Charges are deducted from each vendor&apos;s payout balance on confirm.
      </p>
    </div>
  )
}

function EditableVendorChargeSplit({
  transportCost,
  onTransportCostChange,
  charges,
  onChargesChange,
  onRecalculate,
  disabled,
}: {
  transportCost: number
  onTransportCostChange: (value: number) => void
  charges: DeliveryRunVendorCharge[]
  onChargesChange: (charges: DeliveryRunVendorCharge[]) => void
  onRecalculate: () => void
  disabled?: boolean
}) {
  const total = Math.max(0, Number(transportCost) || 0)
  const allocated = sumAllocationAmounts(charges)
  const remainder = roundMoney(total - allocated)
  const balanced = total <= 0 || charges.length === 0 || Math.abs(remainder) < 0.01

  const updateCharge = (vendorId: string, amount: number) => {
    const next = charges.map((c) =>
      c.vendor_id === vendorId
        ? { ...c, allocated_amount: roundMoney(amount) }
        : c
    )
    onChargesChange(
      allocationSharesFromAmounts(total, next).map((row) => ({
        ...row,
        vendor_name: row.vendor_name ?? 'Unknown vendor',
      }))
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Transport cost (GHS)</label>
        <input
          type="number"
          step="0.01"
          min={0}
          disabled={disabled}
          value={total === 0 ? '' : total}
          onChange={(e) => onTransportCostChange(Math.max(0, Number(e.target.value) || 0))}
          className="form-input"
          placeholder="0"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Vendor charge split</p>
        <button
          type="button"
          disabled={disabled || total <= 0 || charges.length === 0}
          onClick={onRecalculate}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Split by quantity
        </button>
      </div>

      {total > 0 && charges.length === 0 ? (
        <p className="text-xs text-slate-500">No vendor lines to allocate — add products with quantity on this run.</p>
      ) : charges.length > 0 ? (
        <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-right px-3 py-2 font-medium">Units</th>
                <th className="text-right px-3 py-2 font-medium">Share</th>
                <th className="text-right px-3 py-2 font-medium">Charge (GHS)</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.vendor_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-800">{c.vendor_name}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(c.quantity_delivered)}</td>
                  <td className="px-3 py-2 text-right">{c.share_percent.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      disabled={disabled || total <= 0}
                      value={c.allocated_amount === 0 ? '' : c.allocated_amount}
                      onChange={(e) => updateCharge(c.vendor_id, Number(e.target.value) || 0)}
                      className="form-input w-24 text-right font-mono text-xs py-1"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > 0 && charges.length > 0 && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-xs',
            balanced ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-800'
          )}
        >
          <p>
            Allocated: <span className="font-mono font-semibold">{formatGHS(allocated)}</span>
            {' · '}
            Transport: <span className="font-mono font-semibold">{formatGHS(total)}</span>
            {!balanced && (
              <>
                {' · '}
                Difference: <span className="font-mono font-semibold">{formatGHS(remainder)}</span>
              </>
            )}
          </p>
          {!balanced && (
            <p className="mt-1">Charges must equal transport cost before you can confirm.</p>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Adjust total cost or each vendor&apos;s charge. Use &quot;Split by quantity&quot; to reset to the default share.
      </p>
    </div>
  )
}

function DeliveriesContent() {
  const searchParams = useSearchParams()
  const [runs, setRuns] = useState<DeliveryRun[]>([])
  const [stock, setStock] = useState<{ product_id: string; product_name: string; on_hand: number }[]>([])
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterSupermarket, setFilterSupermarket] = useState(searchParams?.get('supermarket_id') ?? '')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [createModalError, setCreateModalError] = useState<string | null>(null)
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null)
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null)
  const [confirmModalRun, setConfirmModalRun] = useState<DeliveryRun | null>(null)
  const [confirmTransportCost, setConfirmTransportCost] = useState(0)
  const [confirmAllocation, setConfirmAllocation] = useState<DeliveryRunVendorCharge[]>([])
  const [confirmAllocationBase, setConfirmAllocationBase] = useState<DeliveryRunVendorCharge[]>([])
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [confirmAllocationLoading, setConfirmAllocationLoading] = useState(false)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [expandedChargesByRun, setExpandedChargesByRun] = useState<Record<string, DeliveryRunVendorCharge[]>>({})
  const [loadingExpandedChargesId, setLoadingExpandedChargesId] = useState<string | null>(null)
  const [runPage, setRunPage] = useState(1)

  const [form, setForm] = useState<{
    supermarket_id: string
    delivery_date: string
    total_transport_cost: number
    notes: string
    items: RunItemRow[]
  }>({
    supermarket_id: '',
    delivery_date: new Date().toISOString().slice(0, 10),
    total_transport_cost: 0,
    notes: '',
    items: [{ product_id: '', quantity_delivered: 1 }],
  })

  const loadRuns = useCallback(async () => {
    const r = await deliveryService.getAllRuns({
      supermarket_id: filterSupermarket || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    })
    setRuns(r)
  }, [filterSupermarket, filterFrom, filterTo])

  const loadReferenceData = useCallback(async () => {
    const [stockRows, s, p, v] = await Promise.all([
      intakeService.getStockByProduct(),
      supermarketService.getAll(),
      productService.getAll(),
      vendorService.getAll(),
    ])
    setStock(stockRows.map((x) => ({ product_id: x.product_id, product_name: x.product_name, on_hand: x.on_hand })))
    setSupermarkets(s)
    setProducts(p)
    setVendors(v)
  }, [])

  const refreshDeliveries = useCallback(async () => {
    try {
      await Promise.all([loadRuns(), loadReferenceData()])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [loadRuns, loadReferenceData])

  useEffect(() => {
    setLoading(true)
    refreshDeliveries()
  }, [refreshDeliveries])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setRunPage(1)
  }, [filterSupermarket, filterFrom, filterTo])

  const vendorNameById = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors])

  const formAllocationPreview = useMemo(() => {
    const cost = Number(form.total_transport_cost) || 0
    if (cost <= 0) return []
    const lines = form.items
      .filter((i) => i.product_id && i.quantity_delivered > 0)
      .map((i) => {
        const product = products.find((p) => p.id === i.product_id)
        const vendorId = product?.vendor_id ?? ''
        return {
          vendor_id: vendorId,
          vendor_name: vendorNameById.get(vendorId) ?? 'Unknown vendor',
          quantity_delivered: i.quantity_delivered,
        }
      })
    return allocateTransportCostByQuantity(cost, lines)
  }, [form.total_transport_cost, form.items, products, vendorNameById])

  const paginatedRuns = useMemo(
    () => getPageSlice(runs, runPage, DEFAULT_PAGE_SIZE),
    [runs, runPage]
  )

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ msg, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 3500)
  }

  const showModalError = (
    msg: string,
    target: 'create' | 'confirm'
  ) => {
    if (target === 'create') setCreateModalError(msg)
    else setConfirmModalError(msg)
  }

  const addItemRow = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { product_id: '', quantity_delivered: 1 }] }))
  }

  const updateItem = (index: number, field: 'product_id' | 'quantity_delivered', value: string | number) => {
    setForm((prev) => {
      const next = [...prev.items]
      next[index] = { ...next[index], [field]: field === 'quantity_delivered' ? Number(value) || 0 : value }
      return { ...prev, items: next }
    })
  }

  const removeItemRow = (index: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : [{ product_id: '', quantity_delivered: 1 }],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.supermarket_id) {
      showToast('Please select a supermarket.', 'error')
      return
    }
    const validItems = form.items.filter((i) => i.product_id && i.quantity_delivered > 0)
    if (validItems.length === 0) {
      showToast('Add at least one product with quantity.', 'error')
      return
    }

    const requestedByProduct = new Map<string, number>()
    for (const item of validItems) {
      requestedByProduct.set(item.product_id, (requestedByProduct.get(item.product_id) ?? 0) + item.quantity_delivered)
    }
    for (const [productId, requested] of requestedByProduct) {
      const s = stock.find((x) => x.product_id === productId)
      const onHand = s?.on_hand ?? 0
      if (requested > onHand) {
        showToast(`${s?.product_name ?? 'Product'}: cannot deliver ${requested} — only ${onHand} on hand.`, 'error')
        return
      }
    }

    setSubmitting(true)
    setCreateModalError(null)
    try {
      const payload: CreateDeliveryRunPayload = {
        supermarket_id: form.supermarket_id,
        delivery_date: form.delivery_date,
        total_transport_cost: Number(form.total_transport_cost) || 0,
        notes: form.notes.trim() || undefined,
        items: validItems.map((i) => ({ product_id: i.product_id, quantity_delivered: i.quantity_delivered })),
      }
      await deliveryService.createRun(payload)
      showToast('Delivery run recorded. Transport cost saved.')
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('delivery-created'))
      setModalOpen(false)
      setForm({
        supermarket_id: '',
        delivery_date: new Date().toISOString().slice(0, 10),
        total_transport_cost: 0,
        notes: '',
        items: [{ product_id: '', quantity_delivered: 1 }],
      })
      refreshDeliveries()
    } catch (e: unknown) {
      showModalError(e instanceof Error ? e.message : 'Failed to create delivery run', 'create')
    } finally {
      setSubmitting(false)
    }
  }

  const recalculateConfirmSplit = (cost: number, base?: DeliveryRunVendorCharge[]) => {
    const lines = (base ?? confirmAllocationBase).map((c) => ({
      vendor_id: c.vendor_id,
      vendor_name: c.vendor_name,
      quantity_delivered: c.quantity_delivered,
    }))
    return allocateTransportCostByQuantity(cost, lines).map((row) => ({
      ...row,
      vendor_name: row.vendor_name ?? 'Unknown vendor',
    }))
  }

  const buildAllocationBaseFromRun = (run: DeliveryRun): DeliveryRunVendorCharge[] => {
    const items = (run.items ?? []) as Array<{
      quantity_delivered: number
      product?: { vendor_id?: string; name?: string }
    }>
    const byVendor = new Map<string, { vendor_name: string; quantity_delivered: number }>()
    for (const item of items) {
      const vendorId = item.product?.vendor_id?.trim()
      const qty = Math.max(0, Number(item.quantity_delivered) || 0)
      if (!vendorId || qty <= 0) continue
      const name = vendorNameById.get(vendorId) ?? 'Unknown vendor'
      const cur = byVendor.get(vendorId) ?? { vendor_name: name, quantity_delivered: 0 }
      cur.quantity_delivered += qty
      byVendor.set(vendorId, cur)
    }
    return [...byVendor.entries()].map(([vendor_id, v]) => ({
      vendor_id,
      vendor_name: v.vendor_name,
      quantity_delivered: v.quantity_delivered,
      share_percent: 0,
      allocated_amount: 0,
    }))
  }

  const openConfirmModal = async (run: DeliveryRun) => {
    setConfirmModalRun(run)
    setConfirmAllocation([])
    setConfirmAllocationBase([])
    setConfirmTransportCost(0)
    setConfirmModalError(null)
    setConfirmAllocationLoading(true)
    try {
      const data = await deliveryService.getChargeAllocation(run.id)
      const cost = Number(data.total_transport_cost) || 0
      const baseFromPreview = data.preview.map((row) => ({
        ...row,
        vendor_name: row.vendor_name ?? 'Unknown vendor',
      }))
      const base = baseFromPreview.length > 0 ? baseFromPreview : buildAllocationBaseFromRun(run)
      setConfirmAllocationBase(base)
      setConfirmTransportCost(cost)
      setConfirmAllocation(cost > 0 && base.length > 0 ? recalculateConfirmSplit(cost, base) : [])
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load charge split', 'error')
      setConfirmModalRun(null)
    } finally {
      setConfirmAllocationLoading(false)
    }
  }

  const handleConfirmTransportCostChange = (cost: number) => {
    setConfirmTransportCost(cost)
    if (confirmAllocationBase.length > 0) {
      setConfirmAllocation(cost > 0 ? recalculateConfirmSplit(cost, confirmAllocationBase) : [])
    }
  }

  const toggleExpandedCharges = async (run: DeliveryRun) => {
    if (expandedRunId === run.id) {
      setExpandedRunId(null)
      return
    }
    setExpandedRunId(run.id)
    if (expandedChargesByRun[run.id]?.length) return

    setLoadingExpandedChargesId(run.id)
    try {
      const data = await deliveryService.getChargeAllocation(run.id)
      const charges = (data.applied ?? data.preview).map((row) => ({
        ...row,
        vendor_name: row.vendor_name ?? 'Unknown vendor',
      }))
      setExpandedChargesByRun((prev) => ({ ...prev, [run.id]: charges }))
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to load vendor charges', 'error')
      setExpandedRunId(null)
    } finally {
      setLoadingExpandedChargesId(null)
    }
  }

  const handleConfirmDelivery = async () => {
    if (!confirmModalRun) return
    const runId = confirmModalRun.id
    const total = Math.max(0, Number(confirmTransportCost) || 0)
    const allocated = sumAllocationAmounts(confirmAllocation)

    if (total > 0 && confirmAllocation.length === 0) {
      showModalError('Transport cost is set — add vendor lines on this run or set transport cost to zero.', 'confirm')
      return
    }

    if (total > 0 && confirmAllocation.length > 0 && Math.abs(total - allocated) > 0.01) {
      showModalError(
        `Vendor charges (${allocated.toFixed(2)}) must equal transport cost (${total.toFixed(2)}).`,
        'confirm'
      )
      return
    }

    setConfirmingRunId(runId)
    setConfirmModalError(null)
    try {
      await deliveryService.confirmRun(runId, {
        total_transport_cost: total,
        vendor_charges:
          total > 0 && confirmAllocation.length > 0
            ? confirmAllocation.map((c) => ({
                vendor_id: c.vendor_id,
                vendor_name: c.vendor_name,
                quantity_delivered: c.quantity_delivered,
                share_percent: c.share_percent,
                allocated_amount: c.allocated_amount,
              }))
            : undefined,
      })
      const chargeTotal = confirmAllocation.reduce((s, c) => s + c.allocated_amount, 0)
      const vendorCount = confirmAllocation.length
      const msg =
        chargeTotal > 0 && vendorCount > 0
          ? `Delivery confirmed. ${formatGHS(chargeTotal)} transport split across ${vendorCount} vendor(s) and deducted from balances.`
          : 'Delivery confirmed. Stock at supermarket updated.'
      showToast(msg)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('delivery-confirmed'))
        window.dispatchEvent(new Event('payout-updated'))
      }
      setConfirmModalRun(null)
      refreshDeliveries()
    } catch (e: unknown) {
      showModalError(e instanceof Error ? e.message : 'Failed to confirm delivery', 'confirm')
    } finally {
      setConfirmingRunId(null)
    }
  }

  return (
    <div className="page-container space-y-6">
        <PageToast
          message={toast?.msg ?? null}
          type={toast?.type}
          onDismiss={() => setToast(null)}
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Deliveries</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Record delivery runs and transport cost. On confirm, cost is split across vendors by units delivered and deducted from payout balances.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateModalError(null)
              setModalOpen(true)
            }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New delivery run
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={filterSupermarket}
            onChange={(e) => setFilterSupermarket(e.target.value)}
            className="form-input w-48"
          >
            <option value="">All supermarkets</option>
            {supermarkets.map((s) => (
              <option key={s.id} value={s.id}>{formatSupermarketLabel(s)}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="form-input w-40"
            placeholder="From"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="form-input w-40"
            placeholder="To"
          />
        </div>

        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="data-card flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="data-card text-center py-12">
            <Truck className="w-14 h-14 text-slate-300 mx-auto mb-4" />
            <h3 className="font-display text-lg font-semibold text-slate-600">No delivery runs</h3>
            <p className="text-slate-500 text-sm mt-2">Create a run when you send stock from DistroGH to a supermarket and add the transport cost.</p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              New delivery run
            </button>
          </div>
        ) : (
          <div className="data-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supermarket</th>
                    <th>Date</th>
                    <th className="text-right">Transport cost</th>
                    <th>Items</th>
                    <th>Vendor charges</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRuns.map((run) => {
                    const items = (run.items ?? []) as { product_id: string; quantity_delivered: number; product?: { name: string } }[]
                    const totalQty = items.reduce((s, i) => s + Number(i.quantity_delivered), 0)
                    const isConfirmed = !!run.confirmed_at
                    const isConfirming = confirmingRunId === run.id
                    const charges = expandedChargesByRun[run.id] ?? ((run.vendor_charges ?? []) as DeliveryRunVendorCharge[])
                    const isExpanded = expandedRunId === run.id
                    const chargeTotal = charges.reduce((s, c) => s + Number(c.allocated_amount), 0)
                    return (
                      <Fragment key={run.id}>
                      <tr>
                        <td>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-400" />
                            <span className="font-medium text-slate-800">
                              {(run.supermarket as Supermarket | undefined)
                                ? formatSupermarketLabel(run.supermarket as Supermarket)
                                : '—'}
                            </span>
                          </div>
                        </td>
                        <td className="text-slate-600">{formatDate(run.delivery_date)}</td>
                        <td className="text-right font-mono font-semibold text-emerald-700">
                          {formatGHS(Number(run.total_transport_cost))}
                        </td>
                        <td className="text-slate-600">
                          {items.length} product(s), {formatNumber(totalQty)} units
                        </td>
                        <td className="text-slate-600 text-sm">
                          {isConfirmed && Number(run.total_transport_cost) > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleExpandedCharges(run)}
                              disabled={loadingExpandedChargesId === run.id}
                              className="text-brand-600 hover:text-brand-700 font-medium disabled:opacity-60"
                            >
                              {loadingExpandedChargesId === run.id ? (
                                'Loading…'
                              ) : charges.length > 0 ? (
                                `${charges.length} vendor(s) · ${formatGHS(chargeTotal)}`
                              ) : (
                                'View charge split'
                              )}
                            </button>
                          ) : Number(run.total_transport_cost) > 0 && !isConfirmed ? (
                            <span className="text-amber-700">Split on confirm</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {isConfirmed ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirmed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              <Clock className="w-3.5 h-3.5" />
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="text-slate-500 text-sm max-w-[200px] truncate" title={run.notes ?? ''}>
                          {run.notes ?? '—'}
                        </td>
                        <td>
                          {!isConfirmed && (
                            <button
                              type="button"
                              onClick={() => openConfirmModal(run)}
                              disabled={isConfirming}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {isConfirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              {isConfirming ? 'Confirming…' : 'Confirm delivery'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && charges.length > 0 && (
                        <tr key={`${run.id}-charges`} className="bg-slate-50/80">
                          <td colSpan={8} className="px-4 py-3">
                            <VendorChargeTable charges={charges} totalCost={Number(run.total_transport_cost)} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              <PaginationBar
                page={runPage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={runs.length}
                onPageChange={setRunPage}
              />
            </div>
          </div>
        )}

        <FormModal
          open={modalOpen}
          onClose={() => {
            if (submitting) return
            setCreateModalError(null)
            setModalOpen(false)
          }}
          title="New delivery run"
          description="Record delivery to supermarket and add transport cost for this run."
          maxWidthClass="max-w-lg"
          disableBackdropClose={submitting}
          error={createModalError}
        >
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <FormModalBody>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Supermarket *</label>
                  <select
                    value={form.supermarket_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, supermarket_id: e.target.value }))}
                    className="form-input"
                    required
                  >
                    <option value="">Select supermarket...</option>
                    {supermarkets.map((s) => (
                      <option key={s.id} value={s.id}>{formatSupermarketLabel(s)}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Delivery date *</label>
                    <input
                      type="date"
                      value={form.delivery_date}
                      onChange={(e) => setForm((prev) => ({ ...prev, delivery_date: e.target.value }))}
                      className="form-input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Transport cost (GHS) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form.total_transport_cost === 0 ? '' : form.total_transport_cost}
                      onChange={(e) => setForm((prev) => ({ ...prev, total_transport_cost: Number(e.target.value) || 0 }))}
                      className="form-input"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                    className="form-input"
                    placeholder="e.g. driver, vehicle"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700">Items on this run *</label>
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="text-sm text-brand-600 hover:text-brand-700 font-medium"
                    >
                      + Add line
                    </button>
                  </div>
                  <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                    {form.items.map((row, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <select
                          value={row.product_id}
                          onChange={(e) => updateItem(idx, 'product_id', e.target.value)}
                          className="form-input flex-1 min-w-0"
                        >
                          <option value="">Product...</option>
                          {products.map((p) => {
                            const onHand = stock.find((s) => s.product_id === p.id)?.on_hand ?? 0
                            return (
                              <option key={p.id} value={p.id} disabled={onHand <= 0}>
                                {p.name} {onHand <= 0 ? '(no stock)' : `(${onHand} on hand)`}
                              </option>
                            )
                          })}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={row.product_id ? (stock.find((s) => s.product_id === row.product_id)?.on_hand ?? 9999) : undefined}
                          value={row.quantity_delivered}
                          onChange={(e) => updateItem(idx, 'quantity_delivered', e.target.value)}
                          className={cn(
                            'form-input w-24',
                            row.product_id &&
                              row.quantity_delivered > (stock.find((s) => s.product_id === row.product_id)?.on_hand ?? 0) &&
                              'border-red-300 bg-red-50'
                          )}
                          title={row.product_id ? `Max: ${stock.find((s) => s.product_id === row.product_id)?.on_hand ?? 0} on hand` : undefined}
                        />
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          className="p-2 text-slate-400 hover:text-red-600"
                          title="Remove line"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {formAllocationPreview.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Vendor transport split (preview)</label>
                    <VendorChargeTable
                      charges={formAllocationPreview.map((c) => ({
                        ...c,
                        vendor_name: c.vendor_name ?? 'Unknown vendor',
                      }))}
                      totalCost={Number(form.total_transport_cost) || 0}
                    />
                  </div>
                )}

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
                    className="flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Create delivery run
                  </button>
            </FormModalFooter>
          </form>
        </FormModal>

        <FormModal
          open={!!confirmModalRun}
          onClose={() => {
            if (confirmingRunId) return
            setConfirmModalError(null)
            setConfirmModalRun(null)
          }}
          title="Confirm delivery"
          description="Review transport cost and vendor charges before confirming. Stock is added at the supermarket and charges are deducted from payout balances."
          maxWidthClass="max-w-lg"
          disableBackdropClose={!!confirmingRunId}
          error={confirmModalError}
        >
          {confirmModalRun && (
            <div className="flex min-h-0 flex-1 flex-col">
              <FormModalBody>
                <div className="text-sm text-slate-600">
                  <p>
                    <span className="font-medium text-slate-800">Destination:</span>{' '}
                    {confirmModalRun.supermarket
                      ? formatSupermarketLabel(confirmModalRun.supermarket as Supermarket)
                      : '—'}
                  </p>
                </div>
                {confirmAllocationLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                  </div>
                ) : (
                  <EditableVendorChargeSplit
                    transportCost={confirmTransportCost}
                    onTransportCostChange={handleConfirmTransportCostChange}
                    charges={confirmAllocation}
                    onChargesChange={setConfirmAllocation}
                    onRecalculate={() =>
                      setConfirmAllocation(
                        confirmTransportCost > 0
                          ? recalculateConfirmSplit(confirmTransportCost, confirmAllocationBase)
                          : []
                      )
                    }
                    disabled={!!confirmingRunId}
                  />
                )}
              </FormModalBody>
              <FormModalFooter>
                <button
                  type="button"
                  onClick={() => !confirmingRunId && setConfirmModalRun(null)}
                  disabled={!!confirmingRunId}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelivery}
                  disabled={
                    !!confirmingRunId ||
                    confirmAllocationLoading ||
                    (confirmTransportCost > 0 &&
                      (confirmAllocation.length === 0 ||
                        Math.abs(confirmTransportCost - sumAllocationAmounts(confirmAllocation)) > 0.01))
                  }
                  className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {confirmingRunId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm &amp; deduct charges
                </button>
              </FormModalFooter>
            </div>
          )}
        </FormModal>
      </div>
  )
}

export default function DeliveriesPage() {
  return (
    <Suspense fallback={<div className="page-container"><div className="p-8 text-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mx-auto" /></div></div>}>
      <DeliveriesContent />
    </Suspense>
  )
}
