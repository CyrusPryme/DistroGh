'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  Inbox,
  Plus,
  Package,
  Building2,
  Loader2,
  AlertCircle,
  Filter,
  Trash2,
} from 'lucide-react'
import { intakeService } from '@/services/intake.service'
import { vendorService } from '@/services/vendor.service'
import { productService } from '@/services/product.service'
import { formatDate, formatNumber, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { useSession } from '@/hooks/useSession'
import type { Intake, Vendor, Product } from '@/types'

export default function ReceivingPage() {
  const [intakes, setIntakes] = useState<Intake[]>([])
  const [stock, setStock] = useState<{ product_id: string; product_name: string; received: number; delivered: number; on_hand: number }[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterVendor, setFilterVendor] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [showStock, setShowStock] = useState(true)
  const { role, vendorId, loading: sessionLoading } = useSession({ requireAuth: true })
  const [stockPage, setStockPage] = useState(1)
  const [intakePage, setIntakePage] = useState(1)

  const isVendor = role === 'vendor' && vendorId

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

  const load = async () => {
    if (sessionLoading || role === null) return
    if (role === 'vendor' && !vendorId) return
    setLoading(true)
    try {
      const effectiveVendorId = isVendor ? vendorId! : (filterVendor || undefined)
      const [i, s, v, p] = await Promise.all([
        intakeService.getAll({
          vendor_id: effectiveVendorId,
          from: filterFrom || undefined,
          to: filterTo || undefined,
        }),
        intakeService.getStockByProduct(isVendor ? vendorId! : undefined),
        isVendor ? [] : vendorService.getAll(),
        isVendor ? [] : productService.getAll(),
      ])
      setIntakes(Array.isArray(i) ? i : [])
      setStock(Array.isArray(s) ? s : [])
      setVendors(Array.isArray(v) ? v : [])
      setProducts(Array.isArray(p) ? p : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [sessionLoading, role, vendorId, filterVendor, filterFrom, filterTo])

  useEffect(() => {
    setStockPage(1)
    setIntakePage(1)
  }, [filterVendor, filterFrom, filterTo, role, vendorId])

  const paginatedStock = useMemo(
    () => getPageSlice(stock, stockPage, DEFAULT_PAGE_SIZE),
    [stock, stockPage]
  )
  const paginatedIntakes = useMemo(
    () => getPageSlice(intakes, intakePage, DEFAULT_PAGE_SIZE),
    [intakes, intakePage]
  )

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const productsForVendor = form.vendor_id
    ? products.filter((p) => p.vendor_id === form.vendor_id)
    : products

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
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to record intake', 'error')
    } finally {
      setSubmitting(false)
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
            <h1 className="font-display text-2xl font-bold text-slate-900">Receiving</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {isVendor
                ? 'When your products were received at DistroGH and current stock on hand (read-only).'
                : 'Confirm and record stock received at DistroGH from vendors before sending to supermarkets.'}
            </p>
          </div>
          {!isVendor && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Record intake
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-slate-400" />
          {!isVendor && (
            <select
              value={filterVendor}
              onChange={(e) => setFilterVendor(e.target.value)}
              className="form-input w-48"
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
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

        {showStock && stock.length > 0 && (
          <div className="data-card">
            <h2 className="font-display font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" />
              Stock at DistroGH (received − delivered)
            </h2>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Received</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedStock.map((row) => (
                    <tr key={row.product_id}>
                      <td className="font-medium text-slate-800">{row.product_name}</td>
                      <td className="text-right font-mono">{formatNumber(row.received)}</td>
                      <td className="text-right font-mono">{formatNumber(row.delivered)}</td>
                      <td className="text-right font-mono font-semibold text-emerald-700">{formatNumber(row.on_hand)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationBar
                page={stockPage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={stock.length}
                onPageChange={setStockPage}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowStock(false)}
              className="mt-2 text-sm text-slate-500 hover:text-slate-700"
            >
              Hide summary
            </button>
          </div>
        )}
        {showStock && stock.length === 0 && !loading && (
          <p className="text-slate-500 text-sm">No stock on hand yet. Record intakes to see summary.</p>
        )}
        {!showStock && (
          <button
            type="button"
            onClick={() => setShowStock(true)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Show stock summary
          </button>
        )}

        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {(loading || sessionLoading || role === null || (role === 'vendor' && !vendorId)) ? (
          <div className="data-card flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          </div>
        ) : intakes.length === 0 ? (
          <div className="data-card text-center py-12">
            <Inbox className="w-14 h-14 text-slate-300 mx-auto mb-4" />
            <h3 className="font-display text-lg font-semibold text-slate-600">No intakes recorded</h3>
            <p className="text-slate-500 text-sm mt-2">
              {isVendor ? 'No stock has been received for your products yet.' : 'Record stock when it arrives at DistroGH from vendors.'}
            </p>
            {!isVendor && (
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
          <div className="data-card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {!isVendor && <th>Vendor</th>}
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th>Reference</th>
                    <th>Received date</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedIntakes.map((r) => (
                    <tr key={r.id}>
                      {!isVendor && (
                        <td>
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-400" />
                            <span className="text-slate-800">{(r.vendor as any)?.name ?? '—'}</span>
                          </div>
                        </td>
                      )}
                      <td>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-800">{(r.product as any)?.name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="text-right font-mono">{r.quantity_received}</td>
                      <td className="text-slate-500 text-sm">{r.reference ?? '—'}</td>
                      <td className="text-slate-600">{formatDate(r.received_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationBar
                page={intakePage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={intakes.length}
                onPageChange={setIntakePage}
              />
            </div>
          </div>
        )}

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
                    onChange={(e) => setForm((prev) => ({ ...prev, vendor_id: e.target.value, items: [{ product_id: '', quantity_received: 1 }] }))}
                    className="form-input"
                    required
                  >
                    <option value="">Select vendor...</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
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
                              <option key={p.id} value={p.id}>{p.name}</option>
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
                    className="flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 flex items-center justify-center gap-2 disabled:opacity-60"
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
