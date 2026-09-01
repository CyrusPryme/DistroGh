'use client'

import { useEffect, useState, useMemo } from 'react'
import { Building2, Package, Loader2, AlertCircle, Layers } from 'lucide-react'
import { supermarketService, type SupermarketInventoryRow } from '@/services/supermarket.service'
import { useSession } from '@/hooks/useSession'
import { formatNumber, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTableShell } from '@/components/shared/DataTableShell'
import { formatDisplayName } from '@/lib/format-display-name'
import { usePageSize } from '@/hooks/usePageSize'

export default function StockAtSupermarketsPage() {
  useSession({ redirectVendorFromAdmin: true })
  const [rows, setRows] = useState<SupermarketInventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterSupermarket, setFilterSupermarket] = useState('')
  const [smPage, setSmPage] = useState(1)
  const [smPageSize, setSmPageSize] = usePageSize('stock-at-supermarkets', DEFAULT_PAGE_SIZE)
  const [productPages, setProductPages] = useState<Record<string, number>>({})
  const [productPageSize, setProductPageSize] = usePageSize('stock-at-supermarkets-products', DEFAULT_PAGE_SIZE)

  useEffect(() => {
    async function load() {
      try {
        const data = await supermarketService.getInventoryBySupermarket()
        setRows(Array.isArray(data) ? data : [])
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load store stock')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const bySupermarket = rows.reduce((acc, r) => {
    if (!acc[r.supermarket_id]) acc[r.supermarket_id] = { name: r.supermarket_name, products: [] }
    acc[r.supermarket_id].products.push(r)
    return acc
  }, {} as Record<string, { name: string; products: SupermarketInventoryRow[] }>)

  const supermarketIds = Object.keys(bySupermarket).sort((a, b) =>
    bySupermarket[a].name.localeCompare(bySupermarket[b].name)
  )
  const filteredIds = filterSupermarket
    ? supermarketIds.filter((id) => id === filterSupermarket)
    : supermarketIds

  useEffect(() => {
    setSmPage(1)
    setProductPages({})
  }, [filterSupermarket])

  const paginatedSmIds = useMemo(
    () => getPageSlice(filteredIds, smPage, smPageSize),
    [filteredIds, smPage, smPageSize]
  )

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title="Stock at supermarkets"
        description="Which supermarkets have which products. Updated when deliveries are confirmed and when sales are imported."
      />

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {supermarketIds.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Filter by supermarket</label>
          <select
            value={filterSupermarket}
            onChange={(e) => setFilterSupermarket(e.target.value)}
            className="form-input w-56"
          >
            <option value="">All supermarkets</option>
            {supermarketIds.map((id) => (
              <option key={id} value={id}>{bySupermarket[id].name}</option>
            ))}
          </select>
        </div>
      )}

      {filteredIds.length === 0 && !error ? (
        <div className="data-card text-center py-12">
          <Layers className="w-14 h-14 text-slate-300 mx-auto mb-4" />
          <h3 className="font-display text-lg font-semibold text-slate-600">No store stock yet</h3>
          <p className="text-slate-500 text-sm mt-2">
            Confirm deliveries on the Deliveries page to add stock here. Sales imports will deduct from these quantities.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {paginatedSmIds.map((supId) => {
            const { name, products } = bySupermarket[supId]
            const sortedProducts = [...products].sort((a, b) => a.product_name.localeCompare(b.product_name))
            const pPage = productPages[supId] ?? 1
            const paginatedProducts = getPageSlice(sortedProducts, pPage, productPageSize)
            return (
              <div key={supId} className="data-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <Building2 className="w-5 h-5 text-slate-500" />
                  <h2 className="font-display font-semibold text-slate-800 truncate">{formatDisplayName(name)}</h2>
                  <span className="text-slate-500 text-sm">
                    {products.length} product(s), {formatNumber(products.reduce((s, p) => s + p.quantity, 0))} units
                  </span>
                </div>
                <DataTableShell
                  pagination={
                    <PaginationBar
                      page={pPage}
                      pageSize={productPageSize}
                      totalItems={sortedProducts.length}
                      onPageChange={(p) => setProductPages((prev) => ({ ...prev, [supId]: p }))}
                      onPageSizeChange={setProductPageSize}
                    />
                  }
                  className="rounded-none border-0 shadow-none"
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="min-w-[220px]">Product</th>
                        <th className="text-right">Quantity on hand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedProducts.map((r) => (
                          <tr key={`${r.supermarket_id}-${r.product_id}`}>
                            <td className="min-w-[220px]">
                              <div className="flex items-center gap-2 min-w-0">
                                <Package className="w-4 h-4 text-slate-400 shrink-0" />
                                <span className="font-semibold text-slate-800 truncate">{formatDisplayName(r.product_name)}</span>
                              </div>
                            </td>
                            <td className="text-right tabular-nums font-semibold text-emerald-700">
                              {formatNumber(r.quantity)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </DataTableShell>
              </div>
            )
          })}
          <PaginationBar
            page={smPage}
            pageSize={smPageSize}
            totalItems={filteredIds.length}
            onPageChange={setSmPage}
            onPageSizeChange={setSmPageSize}
            className="border-0 pt-0"
          />
        </div>
      )}
    </div>
  )
}
