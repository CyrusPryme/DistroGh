'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Plus,
  Search,
  Package,
  AlertCircle,
  RotateCcw,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { ProductModal } from '@/components/products/ProductModal'
import { ProductDetailPanel } from '@/components/products/ProductDetailPanel'
import { createProductAdmin } from './actions'
import { productService } from '@/services/product.service'
import { vendorService } from '@/services/vendor.service'
import { returnsService } from '@/services/returns.service'
import { settingsService } from '@/services/settings.service'
import { intakeService } from '@/services/intake.service'
import { formatGHS, formatDate, cn } from '@/lib/utils'
import { resolveProductPriceTiers } from '@/lib/product-pricing'
import { mergeCategoryOptions } from '@/lib/product-categories'
import type { Product, Vendor, ProductReturn } from '@/types'
import type { ProductFormValues } from '@/lib/validations'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE, ALL_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { useSession } from '@/hooks/useSession'
import { useToast } from '@/hooks/useToast'
import { usePageSize } from '@/hooks/usePageSize'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const RETURN_REASON_LABELS: Record<string, string> = {
  expired: 'Expired',
  defective_product: 'Defective product',
  defective_packaging: 'Defective packaging',
  other: 'Other',
}

type StockRow = { product_id: string; on_hand: number }

function productStatusBadge(product: Product): { label: string; tone: string } {
  const expiry = product.expiry_date?.trim()
  if (!expiry) return { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  const exp = new Date(expiry)
  const now = new Date()
  if (Number.isNaN(exp.getTime())) return { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (exp < now) return { label: 'Expired', tone: 'bg-red-50 text-red-700 border-red-200' }
  const days = Math.ceil((exp.getTime() - now.getTime()) / 86400000)
  if (days <= 30) return { label: 'Expiring', tone: 'bg-amber-50 text-amber-800 border-amber-200' }
  return { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
}

function ProductThumbnail({ product }: { product: Product }) {
  const imagePath = product.product_image_paths?.[0]
  return (
    <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
      {imagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagePath} alt="" className="w-full h-full object-cover" />
      ) : (
        <Package className="w-4 h-4 text-slate-400" />
      )}
    </div>
  )
}

function ProductsContent() {
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [stockByProduct, setStockByProduct] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterVendor, setFilterVendor] = useState(searchParams?.get('vendor_id') ?? '')
  const [filterCategory, setFilterCategory] = useState('')
  const [advancedSkuSearch, setAdvancedSkuSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast(3500)
  const { role, vendorId, loading: sessionLoading } = useSession({ requireAuth: true })
  const [returnsList, setReturnsList] = useState<ProductReturn[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [productPage, setProductPage] = useState(1)
  const [productPageSize, setProductPageSize] = usePageSize('products', DEFAULT_PAGE_SIZE)
  const [returnsPage, setReturnsPage] = useState(1)
  const [returnsPageSize, setReturnsPageSize] = usePageSize('products-returns', DEFAULT_PAGE_SIZE)

  const isAdmin = role === 'admin'

  const load = async () => {
    setLoading(true)
    try {
      const isVendor = role === 'vendor' && vendorId
      const vendorFilter = isVendor ? vendorId! : undefined
      const [ps, vs, returnsData, catsResult, stockRows] = await Promise.all([
        isVendor ? productService.getByVendor(vendorId!) : productService.getAll(),
        isVendor
          ? (async () => {
              const v = await vendorService.getById(vendorId!)
              return v ? [v] : []
            })()
          : vendorService.getAll(),
        returnsService.getAll(isVendor ? { vendor_id: vendorId! } : {}),
        settingsService.getCategoryNames().catch(() => [] as string[]),
        intakeService.getStockByProduct(vendorFilter).catch(() => [] as StockRow[]),
      ])
      const productList = Array.isArray(ps) ? ps : []
      setProducts(productList)
      setVendors(Array.isArray(vs) ? vs : [])
      setReturnsList(returnsData)
      setStockByProduct(new Map((stockRows as StockRow[]).map((s) => [s.product_id, s.on_hand])))
      const fromProducts = [...new Set(productList.map((p) => p.category).filter((c): c is string => !!c))]
      setCategories(mergeCategoryOptions(catsResult, fromProducts))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  const canLoad = !sessionLoading && role !== null && (role !== 'vendor' || vendorId != null)
  useEffect(() => {
    if (!canLoad) return
    load()
  }, [canLoad, role, vendorId, sessionLoading])

  const handleSubmit = async (data: ProductFormValues, extras?: { imageFiles?: File[] }) => {
    setSubmitting(true)
    try {
      let productImagePaths: string[] = []
      if (extras?.imageFiles?.length) {
        throw new Error('Product image upload is not yet available after the Postgres migration.')
      }

      if (editProduct) {
        const existingPaths = editProduct.product_image_paths ?? []
        const mergedPaths = [...existingPaths, ...productImagePaths]
        const isVendor = role === 'vendor'
        const updatePayload = isVendor
          ? (() => {
              const { distrogh_markup, supermarket_selling_price, ...rest } = data
              return rest
            })()
          : data
        await productService.update(editProduct.id, {
          ...updatePayload,
          product_image_paths: mergedPaths.length ? mergedPaths : undefined,
        })
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
      setDetailProduct(null)
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save product', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Soft delete product "${name}"? This will hide the product but preserve all data.`)) return
    try {
      await productService.delete(id)
      showToast('Product soft deleted successfully')
      if (detailProduct?.id === id) setDetailProduct(null)
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete product', 'error')
    }
  }

  const q = search.trim().toLowerCase()
  const skuQ = advancedSkuSearch.trim().toLowerCase()

  const filtered = products.filter((p) => {
    const vendorName = (p.vendor as { name?: string } | undefined)?.name?.toLowerCase() ?? ''
    const barcode = p.barcode?.toLowerCase() ?? ''
    const sku = p.sku?.toLowerCase() ?? ''
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      barcode.includes(q) ||
      vendorName.includes(q)
    const matchesSku = !skuQ || sku.includes(skuQ)
    const matchesVendor = !filterVendor || p.vendor_id === filterVendor
    const matchesCategory = !filterCategory || (p.category ?? '') === filterCategory
    return matchesSearch && matchesSku && matchesVendor && matchesCategory
  })

  useEffect(() => {
    setProductPage(1)
  }, [search, filterVendor, filterCategory, advancedSkuSearch])

  const paginatedProducts = useMemo(
    () => getPageSlice(filtered, productPage, productPageSize),
    [filtered, productPage, productPageSize]
  )

  const paginatedReturns = useMemo(
    () => getPageSlice(returnsList, returnsPage, returnsPageSize),
    [returnsList, returnsPage, returnsPageSize]
  )

  const openEdit = (product: Product) => {
    setDetailProduct(null)
    setEditProduct(product)
    setModalOpen(true)
  }

  const activeFilterCount = [filterVendor, filterCategory, advancedSkuSearch].filter(Boolean).length

  if (!canLoad || loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading products...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-5">
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={dismissToast} />

      <PageHeader
        title="Products"
        description={`${products.length} in catalog${filtered.length !== products.length ? ` · ${filtered.length} shown` : ''}`}
        actions={
          isAdmin ? (
            <button
              onClick={() => {
                setEditProduct(null)
                setModalOpen(true)
              }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          ) : undefined
        }
      />

      {/* Compact search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-10 w-full"
            placeholder="Search name, barcode, or vendor…"
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={cn(
            'btn-secondary shrink-0',
            (filtersOpen || activeFilterCount > 0) && 'border-brand-300 bg-brand-50 text-brand-800'
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {filtersOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 flex flex-wrap gap-3 items-end">
          {isAdmin && (
            <label className="text-sm">
              <span className="block text-xs font-medium text-slate-500 mb-1">Vendor</span>
              <select
                value={filterVendor}
                onChange={(e) => setFilterVendor(e.target.value)}
                className="form-input min-w-[10rem]"
              >
                <option value="">All vendors</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500 mb-1">Category</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="form-input min-w-[10rem]"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500 mb-1">SKU (advanced)</span>
            <input
              value={advancedSkuSearch}
              onChange={(e) => setAdvancedSkuSearch(e.target.value)}
              className="form-input min-w-[10rem] font-mono text-sm"
              placeholder="Filter by SKU…"
            />
          </label>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn-ghost text-sm text-slate-600"
              onClick={() => {
                setFilterVendor('')
                setFilterCategory('')
                setAdvancedSkuSearch('')
              }}
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      )}

      <div className="data-card p-0 overflow-hidden">
        {error ? (
          <div className="flex items-center gap-3 p-6 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Package className="w-7 h-7 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-600">No products found</p>
            <p className="text-slate-400 text-sm mt-1">
              {search || activeFilterCount > 0
                ? 'Try different search or filters.'
                : role === 'vendor'
                  ? 'Ask your admin to add products.'
                  : 'Add your first product.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    {isAdmin && <th>Vendor</th>}
                    <th>Category</th>
                    <th>Barcode</th>
                    <th className="text-right">{isAdmin ? 'Selling price' : 'Your price'}</th>
                    <th className="text-right">Stock</th>
                    <th>Status</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => {
                    const vendor = product.vendor as { name?: string } | undefined
                    const { vendorPrice, distroPrice } = resolveProductPriceTiers(product)
                    const status = productStatusBadge(product)
                    const onHand = stockByProduct.get(product.id)
                    return (
                      <tr
                        key={product.id}
                        className="cursor-pointer hover:bg-slate-50/80"
                        onClick={() => setDetailProduct(product)}
                      >
                        <td>
                          <div className="flex items-center gap-3 min-w-[12rem]">
                            <ProductThumbnail product={product} />
                            <span className="font-medium text-slate-800 truncate">{product.name}</span>
                          </div>
                        </td>
                        {isAdmin && (
                          <td>
                            <Link
                              href={`/dashboard/vendors/${product.vendor_id}`}
                              className="text-brand-600 hover:underline text-sm"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {vendor?.name ?? '—'}
                            </Link>
                          </td>
                        )}
                        <td className="text-slate-600 text-sm">{product.category?.trim() || '—'}</td>
                        <td className="font-mono text-sm text-slate-600">{product.barcode?.trim() || '—'}</td>
                        <td className="text-right font-mono font-semibold text-slate-800">
                          {formatGHS(isAdmin ? distroPrice : vendorPrice)}
                        </td>
                        <td className="text-right font-mono text-slate-600 tabular-nums">
                          {onHand != null ? onHand : '—'}
                        </td>
                        <td>
                          <span className={cn('status-badge border text-xs', status.tone)}>{status.label}</span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Product actions"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setDetailProduct(product)}>
                                <Eye className="w-4 h-4" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(product)}>
                                <Pencil className="w-4 h-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600"
                                onClick={() => handleDelete(product.id, product.name)}
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {paginatedProducts.map((product) => {
                const vendor = product.vendor as { name?: string } | undefined
                const { vendorPrice, distroPrice } = resolveProductPriceTiers(product)
                const status = productStatusBadge(product)
                const onHand = stockByProduct.get(product.id)
                return (
                  <div
                    key={product.id}
                    className="p-4 space-y-3 active:bg-slate-50"
                    onClick={() => setDetailProduct(product)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setDetailProduct(product)}
                  >
                    <div className="flex items-start gap-3">
                      <ProductThumbnail product={product} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 leading-snug">{product.name}</p>
                        <p className="text-sm text-slate-500 mt-0.5">{vendor?.name ?? '—'}</p>
                      </div>
                      <p className="font-mono font-semibold text-slate-900 shrink-0">
                        {formatGHS(isAdmin ? distroPrice : vendorPrice)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {product.category && (
                        <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{product.category}</span>
                      )}
                      {product.barcode && (
                        <span className="font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{product.barcode}</span>
                      )}
                      <span className={cn('status-badge border', status.tone)}>{status.label}</span>
                      {onHand != null && (
                        <span className="text-slate-500 ml-auto">Stock: {onHand}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <PaginationBar
              page={productPage}
              pageSize={productPageSize}
              totalItems={filtered.length}
              onPageChange={setProductPage}
              onPageSizeChange={setProductPageSize}
            />
          </>
        )}
      </div>

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
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {paginatedReturns.map((r) => {
                  const amount = Number(r.quantity_returned) * Number(r.unit_price)
                  return (
                    <tr key={r.id}>
                      <td className="font-medium text-slate-800">{(r.product as { name?: string })?.name ?? '—'}</td>
                      <td className="text-slate-600">{(r.supermarket as { name?: string })?.name ?? '—'}</td>
                      <td className="text-right font-mono">{r.quantity_returned}</td>
                      <td className="text-right font-mono text-red-600">−{formatGHS(amount)}</td>
                      <td>
                        <span className="status-badge bg-amber-100 text-amber-800 border-amber-200 text-xs">
                          {RETURN_REASON_LABELS[r.reason] ?? r.reason}
                        </span>
                      </td>
                      <td className="text-slate-500 text-sm">{formatDate(r.return_date)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <PaginationBar
              page={returnsPage}
              pageSize={returnsPageSize}
              totalItems={returnsList.length}
              onPageChange={setReturnsPage}
              onPageSizeChange={setReturnsPageSize}
            />
          </div>
          {returnsPageSize !== ALL_PAGE_SIZE && returnsList.length > returnsPageSize && (
            <p className="text-slate-500 text-sm mt-2">View all returns on the Returns page.</p>
          )}
        </div>
      )}

      <ProductDetailPanel
        open={Boolean(detailProduct)}
        onClose={() => setDetailProduct(null)}
        product={detailProduct}
        stock={
          detailProduct && stockByProduct.has(detailProduct.id)
            ? { on_hand: stockByProduct.get(detailProduct.id)! }
            : null
        }
        isAdmin={isAdmin}
        onEdit={() => detailProduct && openEdit(detailProduct)}
      />

      <ProductModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditProduct(null)
        }}
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
    <Suspense fallback={<div className="page-container"><div className="p-8 text-center text-slate-400">Loading products...</div></div>}>
      <ProductsContent />
    </Suspense>
  )
}
