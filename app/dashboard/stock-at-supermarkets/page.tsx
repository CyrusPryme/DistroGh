'use client'

import { useEffect, useState, useMemo } from 'react'
import { Building2, Package, Loader2, AlertCircle, Layers } from 'lucide-react'
import { supermarketService, type SupermarketInventoryRow } from '@/services/supermarket.service'
import { useSession } from '@/hooks/useSession'
import { formatNumber, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'

export default function StockAtSupermarketsPage() {
  useSession({ redirectVendorFromAdmin: true })
  const [rows, setRows] = useState<SupermarketInventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterSupermarket, setFilterSupermarket] = useState('')
  const [smPage, setSmPage] = useState(1)
  const [productPages, setProductPages] = useState<Record<string, number>>({})

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
    () => getPageSlice(filteredIds, smPage, DEFAULT_PAGE_SIZE),
    [filteredIds, smPage]
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
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Stock at supermarkets</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Which supermarkets have which products. Updated when deliveries are confirmed and when sales are imported.
        </p>
      </div>

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
            const paginatedProducts = getPageSlice(sortedProducts, pPage, DEFAULT_PAGE_SIZE)
            return (
              <div key={supId} className="data-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <Building2 className="w-5 h-5 text-slate-500" />
                  <h2 className="font-display font-semibold text-slate-800">{name}</h2>
                  <span className="text-slate-500 text-sm">
                    {products.length} product(s), {formatNumber(products.reduce((s, p) => s + p.quantity, 0))} units
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="text-right">Quantity on hand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedProducts.map((r) => (
                          <tr key={`${r.supermarket_id}-${r.product_id}`}>
                            <td>
                              <div className="flex items-center gap-2">
                                <Package className="w-4 h-4 text-slate-400" />
                                <span className="font-medium text-slate-800">{r.product_name}</span>
                              </div>
                            </td>
                            <td className="text-right font-mono font-semibold text-emerald-700">
                              {formatNumber(r.quantity)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <PaginationBar
                    page={pPage}
                    pageSize={DEFAULT_PAGE_SIZE}
                    totalItems={sortedProducts.length}
                    onPageChange={(p) => setProductPages((prev) => ({ ...prev, [supId]: p }))}
                  />
                </div>
              </div>
            )
          })}
          <PaginationBar
            page={smPage}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={filteredIds.length}
            onPageChange={setSmPage}
            className="border-0 pt-0"
          />
        </div>
      )}
    </div>
  )
}
