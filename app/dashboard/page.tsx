'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/hooks/useSession'
import { BarChart3, ShoppingCart, Users, CreditCard, Package,
  ArrowRight, AlertCircle, Upload, TrendingUp, Target, Award,
  TrendingDown, RotateCcw, Inbox, Building2
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell
} from 'recharts'
import { KPICard } from '@/components/dashboard/KPICard'
import { salesService } from '@/services/sales.service'
import { vendorService } from '@/services/vendor.service'
import { intakeService } from '@/services/intake.service'
import { returnsService } from '@/services/returns.service'
import {
  formatGHS, formatGHSChartAxis, formatDate, formatWeekRange, formatNumber, cn
} from '@/lib/utils'
import type { DashboardKPIs, VendorBalance, WeeklyRevenue, ProductPerformance } from '@/types'

export default function DashboardPage() {
  const { role, loading: sessionLoading, error: sessionError } = useSession({
    requireAuth: true,
    redirectVendorFromAdmin: true,
  })
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [recentSales, setRecentSales] = useState<any[]>([])
  const [vendorBalances, setVendorBalances] = useState<VendorBalance[]>([])
  const [weeklyRevenue, setWeeklyRevenue] = useState<WeeklyRevenue[]>([])
  const [topProducts, setTopProducts] = useState<ProductPerformance[]>([])
  const [bottomProducts, setBottomProducts] = useState<ProductPerformance[]>([])
  const [topVendorsByIntake, setTopVendorsByIntake] = useState<{ vendor_id: string; vendor_name: string; total_quantity_received: number }[]>([])
  const [topReturnedProducts, setTopReturnedProducts] = useState<{ product_id: string; product_name: string; total_quantity_returned: number; return_count: number }[]>([])
  const [topSupermarkets, setTopSupermarkets] = useState<{ supermarket_id: string; supermarket_name: string; total_sales: number; total_qty: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inventoryStatus, setInventoryStatus] = useState<{ total: number; inStock: number; outOfStock: number }>({ total: 0, inStock: 0, outOfStock: 0 })
  const [salesTarget] = useState(50000) // Mock sales target
  const [pendingPayout, setPendingPayout] = useState(0)

  useEffect(() => {
    if (sessionError) setError(sessionError)
  }, [sessionError])

  useEffect(() => {
    if (sessionLoading || role !== 'admin') return
    
    async function load() {
      setLoading(true)
      try {
        const [
          k,
          sales,
          balances,
          weekly,
          products,
          bottomProds,
          vendorsByIntake,
          returnedProds,
          supermarkets,
        ] = await Promise.all([
          salesService.getDashboardKPIs(),
          salesService.getRecentSales(8),
          vendorService.getBalances(),
          salesService.getWeeklyRevenue(8),
          salesService.getTopProducts(5),
          salesService.getBottomProducts(5),
          intakeService.getTopVendorsByIntake(5).catch(() => []),
          returnsService.getTopReturnedProducts(5).catch(() => []),
          salesService.getTopSupermarketsBySales(5),
        ])
        setKpis(k)
        setRecentSales(sales)
        setVendorBalances(balances)
        setWeeklyRevenue([...weekly].reverse())
        setTopProducts(products)
        setBottomProducts(bottomProds)
        setTopVendorsByIntake(vendorsByIntake)
        setTopReturnedProducts(returnedProds)
        setTopSupermarkets(supermarkets)
        setPendingPayout(2500) // Mock for admin view
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionLoading, role])

  const chartData = weeklyRevenue.map(w => ({
    week: w.week_start ? formatDate(w.week_start).slice(0, 6) : '',
    Sales: Number(w.total_sales),
    Markup: Number(w.total_commission),
  }))

  const topProduct = topProducts[0] // Get top performing product

  const salesProgress = Math.min((kpis?.totalSales || 0) / salesTarget * 100, 100)

  // Never render admin content until role is confirmed; show neutral loading (avoids vendor flash)
  if (sessionLoading || role !== 'admin' || loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading dashboard...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="flex items-center gap-3 p-6 bg-red-50 rounded-xl border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <div>
            <p className="font-semibold text-red-700">Failed to load dashboard</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  // Admin dashboard only (vendors are redirected to /dashboard/vendor)
  return (
    <div className="page-container space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Overview of your distribution operations</p>
        </div>
        <Link
          href="/dashboard/sales/import"
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-md shadow-emerald-600/20 transition-all w-fit"
        >
          <Upload className="w-4 h-4" />
          Import Sales
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Sales"
          value={kpis?.totalSales ?? 0}
          icon={BarChart3}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          isCurrency
        />
        <KPICard
          title="Total Markup"
          value={kpis?.totalCommission ?? 0}
          icon={ShoppingCart}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          isCurrency
        />
        <KPICard
          title="Vendor Payables"
          value={kpis?.totalVendorDue ?? 0}
          icon={CreditCard}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          isCurrency
          subtitle="Total owed to vendors"
        />
        <KPICard
          title="Pending Payouts"
          value={kpis?.pendingPayouts ?? 0}
          icon={AlertCircle}
          iconBg="bg-red-50"
          iconColor="text-red-500"
          isCurrency
          subtitle="Awaiting processing"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <KPICard
          title="Active Vendors"
          value={kpis?.vendorCount ?? 0}
          icon={Users}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
        />
        <KPICard
          title="Products Listed"
          value={kpis?.productCount ?? 0}
          icon={Package}
          iconBg="bg-cyan-50"
          iconColor="text-cyan-600"
        />
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Weekly Revenue Chart */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-display font-semibold text-slate-900">Weekly Revenue</h3>
              <p className="text-xs text-slate-400 mt-0.5">Last 8 weeks</p>
            </div>
            <Link href="/dashboard/reports" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View report <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {chartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
              No sales data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v: number) => [formatGHS(v), '']}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Sales" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Markup" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Products Chart */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-display font-semibold text-slate-900">Top Products</h3>
              <p className="text-xs text-slate-400 mt-0.5">By total sales value</p>
            </div>
            <Link href="/dashboard/products" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              All products <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {topProducts.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
              No sales data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topProducts.map(p => ({
                name: p.product_name.length > 18 ? p.product_name.slice(0, 18) + '…' : p.product_name,
                Sales: p.total_sales,
                Qty: p.total_qty,
              }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v: number) => [formatGHS(v), 'Sales']}
                />
                <Bar dataKey="Sales" fill="#16a34a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent Sales + Vendor Balances */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Sales */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900">Recent Sales</h3>
            <Link href="/dashboard/sales" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-slate-400 py-8 text-sm">
                      No sales data. Import your first Excel file.
                    </td>
                  </tr>
                ) : (
                  recentSales.map(sale => (
                    <tr key={sale.id}>
                      <td>
                        <div className="font-medium text-slate-800 text-sm">
                          {(sale.product as any)?.name ?? '—'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {(sale.product as any)?.vendor?.name ?? ''}
                        </div>
                      </td>
                      <td className="text-slate-600">{formatNumber(sale.qty_sold)}</td>
                      <td className="text-right font-semibold text-slate-800">
                        {formatGHS(Number(sale.total_sales))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Vendor Balances */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900">Vendor Balances</h3>
            <Link href="/dashboard/payouts" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Process payouts <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {vendorBalances.length === 0 ? (
              <div className="text-center text-slate-400 py-8 text-sm">
                No vendor balances yet
              </div>
            ) : (
              vendorBalances.slice(0, 6).map(vb => (
                <div
                  key={vb.vendor_id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold">
                      {vb.vendor_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{vb.vendor_name}</p>
                      <p className="text-xs text-slate-400">{vb.momo_network} · {vb.momo_number}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      'text-sm font-bold',
                      vb.balance > 0 ? 'text-amber-600' : 'text-emerald-600'
                    )}>
                      {formatGHS(vb.balance)}
                    </p>
                    <p className="text-xs text-slate-400">balance</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Admin analytics: selling least/most, vendors by intake, returns, supermarkets */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Least selling products */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-amber-500" />
              Least selling products
            </h3>
            <Link href="/dashboard/reports" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Reports <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {bottomProducts.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">No sales data yet</p>
          ) : (
            <ul className="space-y-2">
              {bottomProducts.map((p, i) => (
                <li key={p.product_id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-sm font-medium text-slate-800">{p.product_name}</span>
                  <span className="text-sm text-slate-500">{formatGHS(p.total_sales)} · {formatNumber(p.total_qty)} units</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Products returned the most */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-red-500" />
              Most returned products
            </h3>
            <Link href="/dashboard/returns" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Returns <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {topReturnedProducts.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">No returns recorded yet</p>
          ) : (
            <ul className="space-y-2">
              {topReturnedProducts.map((r) => (
                <li key={r.product_id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-sm font-medium text-slate-800">{r.product_name}</span>
                  <span className="text-sm text-slate-500">{formatNumber(r.total_quantity_returned)} units ({r.return_count} returns)</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Vendors bringing in most stock */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
              <Inbox className="w-5 h-5 text-emerald-500" />
              Vendors bringing most stock
            </h3>
            <Link href="/dashboard/receiving" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Receiving <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {topVendorsByIntake.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">No intake data yet</p>
          ) : (
            <ul className="space-y-2">
              {topVendorsByIntake.map((v) => (
                <li key={v.vendor_id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-sm font-medium text-slate-800">{v.vendor_name}</span>
                  <span className="text-sm text-slate-500">{formatNumber(v.total_quantity_received)} units received</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top supermarkets by sales */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-500" />
              Top supermarkets by sales
            </h3>
            <Link href="/dashboard/sales" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Sales <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {topSupermarkets.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">No sales data yet</p>
          ) : (
            <ul className="space-y-2">
              {topSupermarkets.map((s) => (
                <li key={s.supermarket_id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-sm font-medium text-slate-800">{s.supermarket_name}</span>
                  <span className="text-sm text-slate-500">{formatGHS(s.total_sales)} · {formatNumber(s.total_qty)} units</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
