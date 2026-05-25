'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
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
} from 'lucide-react'
import { deliveryService, type CreateDeliveryRunPayload } from '@/services/delivery.service'
import { intakeService } from '@/services/intake.service'
import { supermarketService } from '@/services/supermarket.service'
import { productService } from '@/services/product.service'
import { formatGHS, formatDate, formatNumber, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import type { DeliveryRun, Supermarket, Product } from '@/types'

type RunItemRow = { product_id: string; quantity_delivered: number }

function DeliveriesContent() {
  const searchParams = useSearchParams()
  const [runs, setRuns] = useState<DeliveryRun[]>([])
  const [stock, setStock] = useState<{ product_id: string; product_name: string; on_hand: number }[]>([])
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterSupermarket, setFilterSupermarket] = useState(searchParams?.get('supermarket_id') ?? '')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null)
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

  const load = async () => {
    try {
      const [r, stockRows, s, p] = await Promise.all([
        deliveryService.getAllRuns({
          supermarket_id: filterSupermarket || undefined,
          from: filterFrom || undefined,
          to: filterTo || undefined,
        }),
        intakeService.getStockByProduct(),
        supermarketService.getAll(),
        productService.getAll(),
      ])
      setRuns(r)
      setStock(stockRows.map((x) => ({ product_id: x.product_id, product_name: x.product_name, on_hand: x.on_hand })))
      setSupermarkets(s)
      setProducts(p)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [filterSupermarket, filterFrom, filterTo])

  useEffect(() => {
    setRunPage(1)
  }, [filterSupermarket, filterFrom, filterTo])

  const paginatedRuns = useMemo(
    () => getPageSlice(runs, runPage, DEFAULT_PAGE_SIZE),
    [runs, runPage]
  )

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
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
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to create delivery run', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmDelivery = async (runId: string) => {
    setConfirmingRunId(runId)
    try {
      await deliveryService.confirmRun(runId)
      showToast('Delivery confirmed. Stock at supermarket updated.')
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('delivery-confirmed'))
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to confirm delivery', 'error')
    } finally {
      setConfirmingRunId(null)
    }
  }

  return (
    <div className="page-container space-y-6">
        {toast && (
          <div
            className={cn(
              'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium animate-slide-up',
              toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            )}
          >
            {toast.msg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Deliveries</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Record delivery runs from DistroGH to supermarkets and add transport cost for each run.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
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
              <option key={s.id} value={s.id}>{s.name}</option>
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
                    <th>Status</th>
                    <th>Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRuns.map((run) => {
                    const items = (run.items ?? []) as { product_id: string; quantity_delivered: number; product?: { name: string } }[]
                    const totalQty = items.reduce((s, i) => s + Number(i.quantity_delivered), 0)
                    const isConfirmed = !!(run as any).confirmed_at
                    const isConfirming = confirmingRunId === run.id
                    return (
                      <tr key={run.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-400" />
                            <span className="font-medium text-slate-800">{(run.supermarket as any)?.name ?? '—'}</span>
                          </div>
                        </td>
                        <td className="text-slate-600">{formatDate(run.delivery_date)}</td>
                        <td className="text-right font-mono font-semibold text-emerald-700">
                          {formatGHS(Number(run.total_transport_cost))}
                        </td>
                        <td className="text-slate-600">
                          {items.length} product(s), {formatNumber(totalQty)} units
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
                              onClick={() => handleConfirmDelivery(run.id)}
                              disabled={isConfirming}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {isConfirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              {isConfirming ? 'Confirming…' : 'Confirm delivery'}
                            </button>
                          )}
                        </td>
                      </tr>
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
          onClose={() => !submitting && setModalOpen(false)}
          title="New delivery run"
          description="Record delivery to supermarket and add transport cost for this run."
          maxWidthClass="max-w-lg"
          disableBackdropClose={submitting}
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
                      <option key={s.id} value={s.id}>{s.name}</option>
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
