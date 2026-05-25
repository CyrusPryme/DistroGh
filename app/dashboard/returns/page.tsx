'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  RotateCcw,
  Plus,
  Package,
  Building2,
  Calendar,
  FileText,
  Loader2,
  AlertCircle,
  Filter,
  Download,
} from 'lucide-react'
import { returnsService, type CreateReturnPayload } from '@/services/returns.service'
import { createReturnAdmin } from './actions'
import { productService } from '@/services/product.service'
import { supermarketService } from '@/services/supermarket.service'
import { formatGHS, formatDate, downloadBlob, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { useSession } from '@/hooks/useSession'
import type { ProductReturn, ReturnReason, Product, Supermarket } from '@/types'

const REASON_LABELS: Record<ReturnReason, string> = {
  expired: 'Expired product',
  defective_product: 'Defective product',
  defective_packaging: 'Defective packaging',
  other: 'Other',
}

function ReturnsContent() {
  const searchParams = useSearchParams()
  const [returns, setReturns] = useState<ProductReturn[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { role, vendorId, loading: sessionLoading } = useSession({ requireAuth: true })
  const [filterProduct, setFilterProduct] = useState('')
  const [filterSupermarket, setFilterSupermarket] = useState(searchParams?.get('supermarket_id') ?? '')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [returnsPage, setReturnsPage] = useState(1)

  const [form, setForm] = useState<CreateReturnPayload>({
    product_id: '',
    supermarket_id: '',
    quantity_returned: 1,
    unit_price: 0,
    reason: 'other',
    reason_notes: '',
    return_date: new Date().toISOString().slice(0, 10),
  })

  const load = async () => {
    try {
      const filters: Parameters<typeof returnsService.getAll>[0] = {
        product_id: filterProduct || undefined,
        supermarket_id: filterSupermarket || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      }
      if (vendorId && role === 'vendor') (filters as any).vendor_id = vendorId
      const [r, p, s] = await Promise.all([
        returnsService.getAll(filters),
        (vendorId && role === 'vendor') ? productService.getByVendor(vendorId) : productService.getAll(),
        supermarketService.getAll(),
      ])
      setReturns(r)
      setProducts(p)
      setSupermarkets(s)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load returns')
    } finally {
      setLoading(false)
    }
  }

  const canLoad = !sessionLoading && role !== null && (role !== 'vendor' || vendorId != null)
  useEffect(() => {
    if (!canLoad) return
    load()
  }, [canLoad, vendorId, role, sessionLoading, filterProduct, filterSupermarket, filterFrom, filterTo])

  useEffect(() => {
    setReturnsPage(1)
  }, [filterProduct, filterSupermarket, filterFrom, filterTo])

  const paginatedReturns = useMemo(
    () => getPageSlice(returns, returnsPage, DEFAULT_PAGE_SIZE),
    [returns, returnsPage]
  )

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleProductSelect = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    setForm((prev) => ({
      ...prev,
      product_id: productId,
      unit_price: product?.selling_price ?? prev.unit_price,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.product_id || !form.supermarket_id || form.quantity_returned < 1 || form.unit_price < 0) {
      showToast('Please fill required fields.', 'error')
      return
    }
    setSubmitting(true)
    try {
      const result = await createReturnAdmin(form)
      if ('error' in result) {
        showToast(result.error, 'error')
        return
      }
      showToast('Return recorded. Deductions will apply to sales and product dashboards.')
      setModalOpen(false)
      setForm({
        product_id: '',
        supermarket_id: '',
        quantity_returned: 1,
        unit_price: 0,
        reason: 'other',
        reason_notes: '',
        return_date: new Date().toISOString().slice(0, 10),
      })
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to record return', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const filteredProducts = role === 'vendor' && vendorId ? products.filter((p) => p.vendor_id === vendorId) : products

  const handleExportCSV = () => {
    const headers = ['Product', 'Supermarket', 'Qty', 'Unit Price', 'Amount', 'Reason', 'Notes', 'Return Date']
    const rows = returns.map((r) => {
      const amount = Number(r.quantity_returned) * Number(r.unit_price)
      return [
        (r.product as any)?.name ?? '',
        (r.supermarket as any)?.name ?? '',
        r.quantity_returned,
        Number(r.unit_price).toFixed(2),
        amount.toFixed(2),
        REASON_LABELS[r.reason],
        (r.reason_notes ?? '').replace(/"/g, '""'),
        r.return_date ?? '',
      ]
    })
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c)}"`).join(','))].join('\n')
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `returns_${filterFrom || 'all'}_${filterTo || 'all'}.csv`)
  }

  if (!canLoad || loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          <span className="text-sm font-medium">Loading returns...</span>
        </div>
      </div>
    )
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
          <h1 className="font-display text-2xl font-bold text-slate-900">Returned / Defective Items</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {role === 'vendor'
              ? 'Returns reported by supermarkets (defective, expired, or unacceptable items).'
              : 'Record returns from supermarkets. Deductions are applied to sales and product dashboards.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {returns.length > 0 && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Record return
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          value={filterProduct}
          onChange={(e) => setFilterProduct(e.target.value)}
          className="form-input w-48"
        >
          <option value="">All products</option>
          {filteredProducts.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
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
        {(filterProduct || filterSupermarket || filterFrom || filterTo) && (
          <button
            type="button"
            onClick={() => { setFilterProduct(''); setFilterSupermarket(''); setFilterFrom(''); setFilterTo('') }}
            className="text-xs text-brand-600 hover:underline font-medium"
          >
            Clear filters
          </button>
        )}
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
      ) : returns.length === 0 ? (
        <div className="data-card text-center py-12">
          <RotateCcw className="w-14 h-14 text-slate-300 mx-auto mb-4" />
          <h3 className="font-display text-lg font-semibold text-slate-600">No returns recorded</h3>
          <p className="text-slate-500 text-sm mt-2">
            {role === 'vendor'
              ? 'No returns for your products yet.'
              : 'Record a return when a supermarket returns items (e.g. expired or defective).'}
          </p>
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4" />
              Record return
            </button>
          )}
        </div>
      ) : (
        <div className="data-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Supermarket</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit price</th>
                  <th className="text-right">Amount</th>
                  <th>Reason</th>
                  <th>Notes</th>
                  <th>Return date</th>
                </tr>
              </thead>
              <tbody>
                {paginatedReturns.map((r) => {
                  const amount = Number(r.quantity_returned) * Number(r.unit_price)
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-800">{(r.product as any)?.name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="text-slate-600">{(r.supermarket as any)?.name ?? '—'}</td>
                      <td className="text-right font-mono">{r.quantity_returned}</td>
                      <td className="text-right font-mono">{formatGHS(Number(r.unit_price))}</td>
                      <td className="text-right font-mono font-semibold text-red-600">−{formatGHS(amount)}</td>
                      <td>
                        <span className="status-badge bg-amber-100 text-amber-800 border-amber-200">
                          {REASON_LABELS[r.reason]}
                        </span>
                      </td>
                      <td className="text-slate-500 text-sm max-w-[180px] truncate" title={r.reason_notes ?? ''}>
                        {r.reason_notes ?? '—'}
                      </td>
                      <td className="text-slate-600">{formatDate(r.return_date)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <PaginationBar
              page={returnsPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={returns.length}
              onPageChange={setReturnsPage}
            />
          </div>
        </div>
      )}

      <FormModal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title="Record return"
        description="Deductions will apply to sales and product reports."
        disableBackdropClose={submitting}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <FormModalBody>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product *</label>
                <select
                  value={form.product_id}
                  onChange={(e) => handleProductSelect(e.target.value)}
                  className="form-input"
                  required
                >
                  <option value="">Select product...</option>
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatGHS(Number(p.selling_price ?? 0))})
                    </option>
                  ))}
                </select>
              </div>
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
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min={1}
                    value={form.quantity_returned}
                    onChange={(e) => setForm((prev) => ({ ...prev, quantity_returned: Number(e.target.value) || 1 }))}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit price (GHS) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={form.unit_price || ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, unit_price: Number(e.target.value) || 0 }))}
                    className="form-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason for return *</label>
                <select
                  value={form.reason}
                  onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value as ReturnReason }))}
                  className="form-input"
                >
                  {Object.entries(REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Additional notes</label>
                <textarea
                  value={form.reason_notes ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, reason_notes: e.target.value }))}
                  className="form-input min-h-[80px]"
                  placeholder="e.g. batch number, damage description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Return date *</label>
                <input
                  type="date"
                  value={form.return_date ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, return_date: e.target.value }))}
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
                  Record return
                </button>
          </FormModalFooter>
        </form>
      </FormModal>
    </div>
  )
}

export default function ReturnsPage() {
  return (
    <Suspense fallback={<div className="page-container"><div className="p-8 text-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin mx-auto" /></div></div>}>
      <ReturnsContent />
    </Suspense>
  )
}
