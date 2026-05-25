'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Upload, Filter, ShoppingCart, AlertCircle, Download, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { salesService } from '@/services/sales.service'
import { vendorService } from '@/services/vendor.service'
import { supermarketService } from '@/services/supermarket.service'
import { productService } from '@/services/product.service'
import { formatGHS, formatDate, formatWeekRange, formatNumber, downloadBlob, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { useSession } from '@/hooks/useSession'
import type { Sale, Vendor, Supermarket, Product } from '@/types'
import { getAgreedUnitPrice, getVendorLineTotal } from '@/lib/vendor-earnings'

type SortKey = 'product' | 'supermarket' | 'week' | 'qty' | 'unit_price' | 'total_sales' | 'markup' | 'vendor_due' | 'vendor'

// Shop price = vendor_price + distrogh_markup; vendor due = qty × vendor_price; markup = qty × distrogh_markup
function getEffectiveAmounts(sale: Sale): { totalSales: number; vendorDue: number; markupAmount: number } {
  const vp = Number((sale.product as { vendor_price?: number })?.vendor_price ?? 0)
  const dm = Number((sale.product as { distrogh_markup?: number })?.distrogh_markup ?? 0)
  const unit = vp + dm
  const qty = sale.qty_sold ?? 0
  const totalSales = Math.round(qty * unit * 100) / 100
  const vendorDue = Math.round(qty * vp * 100) / 100
  const markupAmount = Math.round(qty * dm * 100) / 100
  return { totalSales, vendorDue, markupAmount }
}

function SalesContent() {
  const searchParams = useSearchParams()
  const [sales, setSales] = useState<Sale[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterVendor, setFilterVendor] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [filterSupermarket, setFilterSupermarket] = useState(searchParams?.get('supermarket_id') ?? '')
  const [filterWeekStart, setFilterWeekStart] = useState('')
  const [filterWeekEnd, setFilterWeekEnd] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('week')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const { role, vendorId, loading: sessionLoading } = useSession({ requireAuth: true })
  const [salesPage, setSalesPage] = useState(1)

  const isVendor = role === 'vendor'
  const vendorDueLabel = role === 'admin' ? 'Vendor Due' : 'Your amount'

  const load = async () => {
    setLoading(true)
    try {
      const isVendor = role === 'vendor' && vendorId
      const [s, v, sm, pr] = await Promise.all([
        salesService.getAll({
          week_start: filterWeekStart || undefined,
          week_end: filterWeekEnd || undefined,
          supermarket_id: filterSupermarket || undefined,
          product_id: filterProduct || undefined,
          vendor_id: isVendor ? vendorId! : filterVendor || undefined,
        }),
        isVendor ? [] : vendorService.getAll(),
        supermarketService.getAll(),
        isVendor && vendorId ? productService.getByVendor(vendorId) : productService.getAll(),
      ])
      
      setSales(Array.isArray(s) ? s : [])
      setVendors(Array.isArray(v) ? v : [])
      setSupermarkets(Array.isArray(sm) ? sm : [])
      setProducts(Array.isArray(pr) ? pr : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Only load after we know role; vendors must have vendorId so we only fetch their sales
  const canLoad = !sessionLoading && role !== null && (role !== 'vendor' || vendorId != null)
  useEffect(() => {
    if (!canLoad) return
    load()
  }, [canLoad, sessionLoading, filterWeekStart, filterWeekEnd, filterSupermarket, filterProduct, filterVendor, role, vendorId])

  // Client-side filtering (vendor/product/supermarket/week already applied in load; search is client-side)
  const filtered = useMemo(() => {
    let base = sales
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      base = base.filter(s => {
        const pName = ((s.product as any)?.name ?? '').toLowerCase()
        const sName = ((s.supermarket as any)?.name ?? '').toLowerCase()
        const vName = ((s.product as any)?.vendor?.name ?? '').toLowerCase()
        return pName.includes(q) || sName.includes(q) || vName.includes(q)
      })
    }
    const sorted = [...base].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'product': cmp = ((a.product as any)?.name ?? '').localeCompare((b.product as any)?.name ?? ''); break
        case 'vendor': cmp = ((a.product as any)?.vendor?.name ?? '').localeCompare((b.product as any)?.vendor?.name ?? ''); break
        case 'supermarket': cmp = ((a.supermarket as any)?.name ?? '').localeCompare((b.supermarket as any)?.name ?? ''); break
        case 'week': cmp = (a.week_start ?? '').localeCompare(b.week_start ?? ''); break
        case 'qty': cmp = (a.qty_sold ?? 0) - (b.qty_sold ?? 0); break
        case 'unit_price': cmp = Number(a.unit_price ?? 0) - Number(b.unit_price ?? 0); break
        case 'total_sales': {
          const ea = getEffectiveAmounts(a)
          const eb = getEffectiveAmounts(b)
          cmp = ea.totalSales - eb.totalSales
          break
        }
        case 'markup': {
          const ea = getEffectiveAmounts(a)
          const eb = getEffectiveAmounts(b)
          cmp = ea.markupAmount - eb.markupAmount
          break
        }
        case 'vendor_due': {
          const ea = getEffectiveAmounts(a)
          const eb = getEffectiveAmounts(b)
          cmp = ea.vendorDue - eb.vendorDue
          break
        }
        default: cmp = 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [sales, search, sortKey, sortDir])

  useEffect(() => {
    setSalesPage(1)
  }, [search, filterVendor, filterProduct, filterSupermarket, filterWeekStart, filterWeekEnd, sortKey, sortDir])

  const paginatedSales = useMemo(
    () => getPageSlice(filtered, salesPage, DEFAULT_PAGE_SIZE),
    [filtered, salesPage]
  )

  const handleSort = (key: SortKey) => {
    setSortKey(key)
    setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
  }

  const handleExportCSV = () => {
    const headers = isVendor
      ? ['Product', 'Supermarket', 'Week Start', 'Week End', 'Qty', 'Agreed unit price', vendorDueLabel]
      : [
          'Product',
          'Vendor',
          'Supermarket',
          'Week Start',
          'Week End',
          'Qty',
          'Unit Price',
          'Total Sales',
          'Markup',
          vendorDueLabel,
        ]
      const rows = filtered.map(s => {
      const e = getEffectiveAmounts(s)
      if (isVendor) {
        return [
          (s.product as { name?: string })?.name ?? '',
          (s.supermarket as { name?: string })?.name ?? '',
          s.week_start ?? '',
          s.week_end ?? '',
          s.qty_sold ?? 0,
          getAgreedUnitPrice(s.product as { vendor_price?: number; selling_price?: number }).toFixed(2),
          getVendorLineTotal(s).toFixed(2),
        ]
      }
      return [
        (s.product as { name?: string })?.name ?? '',
        (s.product as { vendor?: { name?: string } })?.vendor?.name ?? '',
        (s.supermarket as { name?: string })?.name ?? '',
        s.week_start ?? '',
        s.week_end ?? '',
        s.qty_sold ?? 0,
        Number(s.unit_price ?? 0).toFixed(2),
        e.totalSales.toFixed(2),
        e.markupAmount.toFixed(2),
        e.vendorDue.toFixed(2),
      ]
    })
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `sales_${filterWeekStart || 'all'}_${filterWeekEnd || 'all'}.csv`)
  }

  const totals = filtered.reduce(
    (acc: { qty: number; sales: number; markup: number; vendorDue: number }, 
    s: Sale) => {
      const e = getEffectiveAmounts(s)
      return {
        qty: acc.qty + s.qty_sold,
        sales: acc.sales + e.totalSales,
        markup: acc.markup + e.markupAmount,
        vendorDue: acc.vendorDue + e.vendorDue,
      }
    },
    { qty: 0, sales: 0, markup: 0, vendorDue: 0 }
  )

  if (!canLoad || loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading sales...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Sales Records</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} sale records</p>
        </div>
        <div className="flex items-center gap-2">
          {filtered.length > 0 && (
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
            <Link
              href="/dashboard/sales/import"
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import Excel
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="data-card py-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Filter Records</span>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search product, supermarket..."
              className="form-input text-sm flex-1 max-w-xs"
            />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Week Start</label>
              <input
                type="date"
                value={filterWeekStart}
                onChange={e => setFilterWeekStart(e.target.value)}
                className="form-input text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Week End</label>
              <input
                type="date"
                value={filterWeekEnd}
                onChange={e => setFilterWeekEnd(e.target.value)}
                className="form-input text-sm"
              />
            </div>
            {role === 'admin' && (
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Vendor</label>
                <select
                  value={filterVendor}
                  onChange={e => setFilterVendor(e.target.value)}
                  className="form-input text-sm appearance-none"
                >
                  <option value="">All Vendors</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Product</label>
              <select
                value={filterProduct}
                onChange={e => setFilterProduct(e.target.value)}
                className="form-input text-sm appearance-none"
              >
                <option value="">All Products</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Supermarket</label>
              <select
                value={filterSupermarket}
                onChange={e => setFilterSupermarket(e.target.value)}
                className="form-input text-sm appearance-none"
              >
                <option value="">All Supermarkets</option>
                {supermarkets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        {(filterWeekStart || filterWeekEnd || filterVendor || filterSupermarket || filterProduct || search) && (
          <button
            onClick={() => { setFilterWeekStart(''); setFilterWeekEnd(''); setFilterVendor(''); setFilterSupermarket(''); setFilterProduct(''); setSearch('') }}
            className="mt-3 text-xs text-brand-600 hover:underline font-medium"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className={cn('grid gap-4', isVendor ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
        {(isVendor
          ? [
              { label: 'Total Qty', value: formatNumber(totals.qty), color: 'text-slate-600' },
              { label: vendorDueLabel, value: formatGHS(totals.vendorDue), color: 'text-emerald-600' },
            ]
          : [
              { label: 'Total Sales', value: formatGHS(totals.sales), color: 'text-blue-600' },
              { label: 'Total Qty', value: formatNumber(totals.qty), color: 'text-slate-600' },
              { label: 'Total Markup', value: formatGHS(totals.markup), color: 'text-violet-600' },
              { label: vendorDueLabel, value: formatGHS(totals.vendorDue), color: 'text-emerald-600' },
            ]
        ).map(({ label, value, color }) => (
          <div key={label} className="kpi-card py-4">
            <p className={cn('text-xl font-display font-bold', color)}>{value}</p>
            <p className="text-xs text-slate-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="data-card p-0 overflow-hidden">
        {error ? (
          <div className="flex items-center gap-3 p-6 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-slate-400">Loading sales...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <ShoppingCart className="w-7 h-7 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-600">No sales found</p>
            <p className="text-slate-400 text-sm mt-1">
              {role === 'admin' ? (
                <Link href="/dashboard/sales/import" className="text-brand-600 hover:underline">Import your first Excel file</Link>
              ) : (
                <span className="text-slate-600">Contact your administrator to add sales data.</span>
              )}
              {role === 'admin' && ' to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" onClick={() => handleSort('product')} className="flex items-center gap-1 hover:text-slate-900 font-medium">
                      Product {sortKey === 'product' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                  </th>
                  {role === 'admin' && (
                    <th>
                      <button type="button" onClick={() => handleSort('vendor')} className="flex items-center gap-1 hover:text-slate-900 font-medium">
                        Vendor {sortKey === 'vendor' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                      </button>
                    </th>
                  )}
                  <th>
                    <button type="button" onClick={() => handleSort('supermarket')} className="flex items-center gap-1 hover:text-slate-900 font-medium">
                      Supermarket {sortKey === 'supermarket' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => handleSort('week')} className="flex items-center gap-1 hover:text-slate-900 font-medium">
                      Week {sortKey === 'week' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                  </th>
                  <th className="text-right">
                    <button type="button" onClick={() => handleSort('qty')} className="inline-flex items-center gap-1 hover:text-slate-900 font-medium ml-auto">
                      Qty {sortKey === 'qty' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                  </th>
                  <th className="text-right">
                    <button type="button" onClick={() => handleSort('unit_price')} className="inline-flex items-center gap-1 hover:text-slate-900 font-medium ml-auto">
                      {isVendor ? 'Agreed price' : 'Unit Price'}{' '}
                      {sortKey === 'unit_price' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                  </th>
                  {!isVendor && (
                    <>
                      <th className="text-right">
                        <button type="button" onClick={() => handleSort('total_sales')} className="inline-flex items-center gap-1 hover:text-slate-900 font-medium ml-auto">
                          Total Sales {sortKey === 'total_sales' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" onClick={() => handleSort('markup')} className="inline-flex items-center gap-1 hover:text-slate-900 font-medium ml-auto">
                          Markup {sortKey === 'markup' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                        </button>
                      </th>
                    </>
                  )}
                  <th className="text-right">
                    <button type="button" onClick={() => handleSort('vendor_due')} className="inline-flex items-center gap-1 hover:text-slate-900 font-medium ml-auto">
                      {vendorDueLabel}{' '}
                      {sortKey === 'vendor_due' ? (sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedSales.map(sale => (
                  <tr key={sale.id}>
                    <td className="font-medium text-slate-800">
                      {(sale.product as any)?.name ?? '—'}
                    </td>
                    {role === 'admin' && (
                      <td className="text-slate-500 text-sm">
                        {(sale.product as any)?.vendor?.name ?? '—'}
                      </td>
                    )}
                    <td className="text-slate-500 text-sm">
                      {(sale.supermarket as any)?.name ?? '—'}
                    </td>
                    <td className="text-xs text-slate-400">
                      {formatWeekRange(sale.week_start, sale.week_end)}
                    </td>
                    <td className="text-right text-slate-600">{formatNumber(sale.qty_sold)}</td>
                    <td className="text-right font-mono text-sm text-slate-600">
                      {formatGHS(
                        isVendor
                          ? getAgreedUnitPrice(sale.product as { vendor_price?: number; selling_price?: number })
                          : Number(sale.unit_price)
                      )}
                    </td>
                    {!isVendor && (
                      <>
                        <td className="text-right font-semibold text-slate-800 font-mono">
                          {formatGHS(getEffectiveAmounts(sale).totalSales)}
                        </td>
                        <td className="text-right text-violet-600 font-mono text-sm">
                          {formatGHS(getEffectiveAmounts(sale).markupAmount)}
                        </td>
                      </>
                    )}
                    <td className="text-right text-emerald-600 font-semibold font-mono">
                      {formatGHS(isVendor ? getVendorLineTotal(sale) : getEffectiveAmounts(sale).vendorDue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {role === 'admin' && (
                  <tr>
                    <td colSpan={4}>Totals ({filtered.length} records)</td>
                    <td className="text-right">{formatNumber(totals.qty)}</td>
                    <td></td>
                    <td className="text-right font-mono">{formatGHS(totals.sales)}</td>
                    <td className="text-right font-mono text-violet-600">{formatGHS(totals.markup)}</td>
                    <td className="text-right font-mono text-emerald-600">{formatGHS(totals.vendorDue)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
            <PaginationBar
              page={salesPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={filtered.length}
              onPageChange={setSalesPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function SalesPage() {
  return (
    <Suspense fallback={<div className="page-container"><div className="p-8 text-center text-slate-400">Loading sales...</div></div>}>
      <SalesContent />
    </Suspense>
  )
}
