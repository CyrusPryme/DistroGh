'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Search, Edit2, Trash2, Package, AlertCircle, Filter, Clock, RotateCcw } from 'lucide-react'
import { ProductModal } from '@/components/products/ProductModal'
import { createProductAdmin } from './actions'
import { productService } from '@/services/product.service'
import { vendorService } from '@/services/vendor.service'
import { returnsService } from '@/services/returns.service'
import { settingsService } from '@/services/settings.service'
import { formatGHS, formatDate, cn } from '@/lib/utils'
import { resolveProductPriceTiers } from '@/lib/product-pricing'
import type { Product, Vendor, ProductReturn } from '@/types'

const RETURN_REASON_LABELS: Record<string, string> = {
  expired: 'Expired',
  defective_product: 'Defective product',
  defective_packaging: 'Defective packaging',
  other: 'Other',
}
import type { ProductFormValues } from '@/lib/validations'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { useSession } from '@/hooks/useSession'

// Helper function for relative time display
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  
  return formatDate(dateString)
}

function ProductsContent() {
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterVendor, setFilterVendor] = useState(searchParams?.get('vendor_id') ?? '')
  const [modalOpen, setModalOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const { role, vendorId, loading: sessionLoading } = useSession({ requireAuth: true })
  const [returnsList, setReturnsList] = useState<ProductReturn[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [productPage, setProductPage] = useState(1)
  const [returnsPage, setReturnsPage] = useState(1)

  const load = async () => {
    setLoading(true)
    try {
      const isVendor = role === 'vendor' && vendorId
      const [ps, vs, returnsData, catsResult] = await Promise.all([
        isVendor ? productService.getByVendor(vendorId!) : productService.getAll(),
        isVendor ? (async () => {
          const v = await vendorService.getById(vendorId!)
          return v ? [v] : []
        })() : vendorService.getAll(),
        returnsService.getAll(isVendor ? { vendor_id: vendorId! } : {}),
        settingsService.getCategoryNames().catch(() => [] as string[]),
      ])
      const productList = Array.isArray(ps) ? ps : []
      setProducts(productList)
      setVendors(Array.isArray(vs) ? vs : [])
      setReturnsList(returnsData)
      const fromProducts = [...new Set(productList.map((p) => (p as any).category).filter((c): c is string => !!c))]
      const merged = [...new Set([...catsResult, ...fromProducts])].sort()
      setCategories(merged)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const canLoad = !sessionLoading && role !== null && (role !== 'vendor' || vendorId != null)
  useEffect(() => {
    if (!canLoad) return
    load()
  }, [canLoad, role, vendorId, sessionLoading])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleSubmit = async (data: ProductFormValues, extras?: { imageFiles?: File[] }) => {
    setSubmitting(true)
    try {
      let productImagePaths: string[] = []
      if (extras?.imageFiles?.length) {
        throw new Error('Product image upload is not yet available after the Postgres migration.')
      }

      if (editProduct) {
        const existingPaths = (editProduct as any).product_image_paths ?? []
        const mergedPaths = [...existingPaths, ...productImagePaths]
        const isVendor = role === 'vendor'
        const updatePayload = isVendor
          ? (() => { const { distrogh_markup, supermarket_selling_price, ...rest } = data; return rest })()
          : data
        await productService.update(editProduct.id, { ...updatePayload, product_image_paths: mergedPaths.length ? mergedPaths : undefined })
        showToast('Product updated successfully')
      } else {
        const result = await createProductAdmin(data, productImagePaths.length ? productImagePaths : undefined)
        if ('error' in result) {
          showToast(result.error, 'error')
          return
        }
        showToast('Product added successfully')
      }
      setModalOpen(false)
      setEditProduct(null)
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Soft delete product "${name}"? This will hide the product but preserve all data. You can restore it later.`)) return
    try {
      await productService.delete(id) // This now calls softDelete
      showToast('Product soft deleted successfully')
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    }
  }

  const filtered = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.vendor as any)?.name?.toLowerCase().includes(search.toLowerCase())
    const matchesVendor = !filterVendor || p.vendor_id === filterVendor
    return matchesSearch && matchesVendor
  })

  useEffect(() => {
    setProductPage(1)
  }, [search, filterVendor])

  const paginatedProducts = useMemo(
    () => getPageSlice(filtered, productPage, DEFAULT_PAGE_SIZE),
    [filtered, productPage]
  )

  const paginatedReturns = useMemo(
    () => getPageSlice(returnsList, returnsPage, DEFAULT_PAGE_SIZE),
    [returnsList, returnsPage]
  )

  if (!canLoad || loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading products...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium animate-slide-up',
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        )}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Products</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {products.length} products in catalog
            {filtered.length !== products.length && ` · ${filtered.length} match filters`}
          </p>
        </div>
        {role === 'admin' && (
          <button
            onClick={() => { setEditProduct(null); setModalOpen(true) }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="form-input pl-10 w-56"
            placeholder="Search products..."
          />
        </div>
        {/* Only show vendor filter to admins - vendors only see their own products */}
        {role === 'admin' && (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filterVendor}
              onChange={e => setFilterVendor(e.target.value)}
              className="form-input pl-10 pr-8 w-48 appearance-none"
            >
              <option value="">All Vendors</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="data-card p-0 overflow-hidden">
        {error ? (
          <div className="flex items-center gap-3 p-6 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-slate-400">Loading products...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Package className="w-7 h-7 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-600">No products found</p>
            <p className="text-slate-400 text-sm mt-1">
              {search || filterVendor ? 'Try different filters.' : role === 'vendor' ? 'Ask your admin to add products.' : 'Add your first product.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>SKU</th>
                  <th>Category</th>
                  {role === 'admin' && <th>Vendor</th>}
                  {role === 'admin' ? (
                    <>
                      <th className="text-right">Vendor price</th>
                      <th className="text-right">Markup</th>
                      <th className="text-right">Distro price</th>
                      <th className="text-right">Supermarket retail</th>
                    </>
                  ) : (
                    <th className="text-right">Your agreed price</th>
                  )}
                  <th>Added</th>
                  <th>Last Updated</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map(product => {
                  const vendor = product.vendor as any
                  const { vendorPrice, distroMarkup, distroPrice, supermarketSellingPrice } =
                    resolveProductPriceTiers(product)
                  return (
                    <tr key={product.id}>
                      <td className="font-medium text-slate-800">{product.name}</td>
                      <td className="text-slate-600 font-mono text-sm">{(product as any).sku ?? '—'}</td>
                      <td className="text-slate-600 text-sm">{(product as any).category ?? '—'}</td>
                      {role === 'admin' && (
                        <td>
                          <Link
                            href={`/dashboard/vendors/${product.vendor_id}`}
                            className="text-brand-600 hover:underline text-sm font-medium"
                          >
                            {vendor?.name ?? '—'}
                          </Link>
                        </td>
                      )}
                      {role === 'admin' ? (
                        <>
                          <td className="text-right font-mono text-slate-800">{formatGHS(vendorPrice)}</td>
                          <td className="text-right">
                            <span className="status-badge bg-violet-50 text-violet-700 border-violet-200 font-mono">
                              {formatGHS(distroMarkup)}
                            </span>
                          </td>
                          <td className="text-right font-semibold font-mono text-slate-800">
                            {formatGHS(distroPrice)}
                          </td>
                          <td className="text-right font-mono text-slate-600">
                            {supermarketSellingPrice != null ? formatGHS(supermarketSellingPrice) : '—'}
                          </td>
                        </>
                      ) : (
                        <td className="text-right font-semibold text-slate-800 font-mono">
                          {formatGHS(vendorPrice)}
                        </td>
                      )}
                      <td className="text-slate-500">{formatDate(product.created_at)}</td>
                      <td>
                        <div className="flex items-center gap-1 text-slate-500 text-sm">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatRelativeTime(product.updated_at)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => { setEditProduct(product); setModalOpen(true) }}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            title="Edit product"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                            title="Soft delete product"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <PaginationBar
              page={productPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={filtered.length}
              onPageChange={setProductPage}
            />
          </div>
        )}
      </div>

      {/* Returned items: products that have been returned with reason */}
      {returnsList.length > 0 && (
        <div className="data-card">
          <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-amber-600" />
            Products with returns
          </h3>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Supermarket</th>
                  <th className="text-right">Qty returned</th>
                  <th className="text-right">Amount</th>
                  <th>Reason</th>
                  <th>Notes</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {paginatedReturns.map((r) => {
                  const amount = Number(r.quantity_returned) * Number(r.unit_price)
                  return (
                    <tr key={r.id}>
                      <td className="font-medium text-slate-800">{(r.product as any)?.name ?? '—'}</td>
                      <td className="text-slate-600">{(r.supermarket as any)?.name ?? '—'}</td>
                      <td className="text-right font-mono">{r.quantity_returned}</td>
                      <td className="text-right font-mono text-red-600">−{formatGHS(amount)}</td>
                      <td>
                        <span className="status-badge bg-amber-100 text-amber-800 border-amber-200 text-xs">
                          {RETURN_REASON_LABELS[r.reason] ?? r.reason}
                        </span>
                      </td>
                      <td className="text-slate-500 text-sm max-w-[160px] truncate" title={r.reason_notes ?? ''}>
                        {r.reason_notes ?? '—'}
                      </td>
                      <td className="text-slate-500 text-sm">{formatDate(r.return_date)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <PaginationBar
              page={returnsPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={returnsList.length}
              onPageChange={setReturnsPage}
            />
          </div>
          {returnsList.length > DEFAULT_PAGE_SIZE && (
            <p className="text-slate-500 text-sm mt-2">View all returns on the Returns page.</p>
          )}
        </div>
      )}

      <ProductModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditProduct(null) }}
        onSubmit={handleSubmit}
        initialData={editProduct}
        vendors={vendors}
        categories={categories}
        isSubmitting={submitting}
        defaultVendorId={role === 'vendor' && vendorId ? vendorId : undefined}
        vendorOnly={role === 'vendor'}
      />
    </div>
  )
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="page-container space-y-6"><div className="p-8 text-center text-slate-400">Loading products...</div></div>}>
      <ProductsContent />
    </Suspense>
  )
}
