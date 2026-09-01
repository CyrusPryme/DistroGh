'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/hooks/useSession'
import {
  BarChart3, ShoppingCart, Users, CreditCard, Package, ArrowRight, AlertCircle, Upload,
  TrendingDown, RotateCcw, Inbox, Building2, PackageOpen,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts'
import { KPICard } from '@/components/dashboard/KPICard'
import { DashboardDateRangePicker } from '@/components/dashboard/DashboardDateRangePicker'
import { DashboardEmptyState } from '@/components/dashboard/DashboardEmptyState'
import { DashboardSortableTable } from '@/components/dashboard/DashboardSortableTable'
import { salesService } from '@/services/sales.service'
import { vendorService } from '@/services/vendor.service'
import { intakeService } from '@/services/intake.service'
import { returnsService } from '@/services/returns.service'
import {
  formatGHS, formatGHSChartAxis, formatSalesPeriod, formatNumber, cn,
} from '@/lib/utils'
import { formatSupermarketLabel } from '@/lib/supermarket-display'
import {
  resolveDashboardDateRange,
  type DashboardDatePreset,
  type DashboardDateRange,
} from '@/lib/dashboard-date-range'
import type {
  DashboardKPIs, VendorBalance, WeeklyRevenue, ProductPerformance, VendorIntakeLeaderboard,
} from '@/types'

function WidgetCard({
  title,
  subtitle,
  icon: Icon,
  iconClass,
  href,
  linkLabel,
  children,
}: {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ className?: string }>
  iconClass?: string
  href?: string
  linkLabel?: string
  children: React.ReactNode
}) {
  return (
    <div className="data-card flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
            {Icon ? <Icon className={cn('h-5 w-5 shrink-0', iconClass)} /> : null}
            {title}
          </h3>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        {href && linkLabel ? (
          <Link
            href={href}
            className="shrink-0 text-xs font-medium text-brand-600 flex items-center gap-1 hover:gap-2 transition-all"
          >
            {linkLabel} <ArrowRight className="w-3 h-3" />
          </Link>
        ) : null}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

export default function DashboardPage() {
  const { role, loading: sessionLoading, error: sessionError } = useSession({
    requireAuth: true,
    redirectVendorFromAdmin: true,
  })

  const [datePreset, setDatePreset] = useState<DashboardDatePreset>('all_time')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const dateRange: DashboardDateRange = useMemo(
    () => resolveDashboardDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo]
  )
  const rangeFilter = useMemo(
    () => (dateRange.preset === 'all_time' ? undefined : { from: dateRange.from, to: dateRange.to }),
    [dateRange]
  )

  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [recentSales, setRecentSales] = useState<any[]>([])
  const [vendorBalances, setVendorBalances] = useState<VendorBalance[]>([])
  const [weeklyRevenue, setWeeklyRevenue] = useState<WeeklyRevenue[]>([])
  const [topProducts, setTopProducts] = useState<ProductPerformance[]>([])
  const [bottomProducts, setBottomProducts] = useState<ProductPerformance[]>([])
  const [topVendorsByIntake, setTopVendorsByIntake] = useState<VendorIntakeLeaderboard[]>([])
  const [topReturnedProducts, setTopReturnedProducts] = useState<
    { product_id: string; product_name: string; total_quantity_returned: number; return_count: number }[]
  >([])
  const [topSupermarkets, setTopSupermarkets] = useState<
    {
      supermarket_id: string
      supermarket_name: string
      supermarket_branch: string | null
      total_sales: number
      total_qty: number
    }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionError) setError(sessionError)
  }, [sessionError])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
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
        salesService.getDashboardKPIs(rangeFilter),
        salesService.getRecentSales(8, undefined, rangeFilter),
        vendorService.getBalances(),
        salesService.getWeeklyRevenue(8, undefined, rangeFilter),
        salesService.getTopProducts(5, undefined, rangeFilter),
        salesService.getBottomProducts(5, rangeFilter),
        intakeService.getTopVendorsByIntake(5, rangeFilter).catch(() => []),
        returnsService.getTopReturnedProducts(5, rangeFilter).catch(() => []),
        salesService.getTopSupermarketsBySales(5, rangeFilter),
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [rangeFilter])

  useEffect(() => {
    if (sessionLoading || role !== 'admin') return
    loadDashboard()
  }, [sessionLoading, role, loadDashboard])

  const chartData = weeklyRevenue.map((w) => ({
    week: w.week_start ? formatSalesPeriod(w.week_start, w.week_end) : '',
    Sales: Number(w.total_sales),
    Markup: Number(w.total_commission),
  }))

  if (sessionLoading || role !== 'admin' || loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
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

  return (
    <div className="page-container space-y-6 animate-fade-in">
      {/* Header + primary CTA */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
            Dashboard
          </h1>
          <p className="text-slate-500 text-sm mt-1">Overview of your distribution operations</p>
        </div>
        <Link
          href="/dashboard/sales/import"
          className="btn-primary inline-flex shrink-0 self-start lg:self-auto rounded-xl px-4 py-2.5 shadow-md shadow-brand-600/20 hover:shadow-lg hover:shadow-brand-600/25 transition-shadow"
        >
          <Upload className="w-4 h-4" />
          Import Sales
        </Link>
      </div>

      {/* Date range toolbar */}
      <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
        <DashboardDateRangePicker
          value={dateRange}
          customFrom={customFrom}
          customTo={customTo}
          onPresetChange={setDatePreset}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      </div>

      {/* KPI grid — unified 6-column layout */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
        <KPICard compact title="Total Sales" value={kpis?.totalSales ?? 0} icon={BarChart3} iconBg="bg-blue-50" iconColor="text-blue-600" isCurrency />
        <KPICard compact title="Total Markup" value={kpis?.totalCommission ?? 0} icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" isCurrency subtitle="Qty × product markup" />
        <KPICard compact title="Vendor Payables" value={kpis?.totalVendorDue ?? 0} icon={CreditCard} iconBg="bg-amber-50" iconColor="text-amber-600" isCurrency subtitle="Owed to vendors" />
        <KPICard compact title="Pending Payouts" value={kpis?.pendingPayouts ?? 0} icon={AlertCircle} iconBg="bg-red-50" iconColor="text-red-500" isCurrency subtitle="Awaiting processing" />
        <KPICard compact title="Active Vendors" value={kpis?.vendorCount ?? 0} icon={Users} iconBg="bg-brand-50" iconColor="text-brand-600" />
        <KPICard compact title="Products Listed" value={kpis?.productCount ?? 0} icon={Package} iconBg="bg-cyan-50" iconColor="text-cyan-600" />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <WidgetCard title="Monthly Sales" subtitle={dateRange.label} href="/dashboard/reports" linkLabel="View report">
          {chartData.length === 0 ? (
            <DashboardEmptyState icon={BarChart3} title="No sales in this period" description="Try a wider date range or import sales data." className="h-52" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(v: number) => [formatGHS(v), '']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Sales" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Markup" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>

        <WidgetCard title="Top Products" subtitle="By sales value in selected period" href="/dashboard/products" linkLabel="All products">
          {topProducts.length === 0 ? (
            <DashboardEmptyState icon={Package} title="No product sales yet" className="h-52" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={topProducts.map((p) => ({
                  name: p.product_name.length > 18 ? `${p.product_name.slice(0, 18)}…` : p.product_name,
                  Sales: p.total_sales,
                }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(v: number) => [formatGHS(v), 'Sales']} />
                <Bar dataKey="Sales" fill="#16a34a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </WidgetCard>
      </div>

      {/* Recent sales + vendor balances */}
      <div className="grid lg:grid-cols-2 gap-6">
        <WidgetCard title="Recent Sales" href="/dashboard/sales" linkLabel="View all">
          <DashboardSortableTable
            rows={recentSales}
            rowKey={(s) => s.id}
            empty={
              <DashboardEmptyState
                icon={ShoppingCart}
                title="No sales in this period"
                description="Import your first Excel file to get started."
              />
            }
            columns={[
              {
                key: 'product',
                header: 'Product',
                sortable: true,
                sortValue: (s) => (s.product as { name?: string })?.name ?? '',
                render: (s) => (
                  <div>
                    <div className="font-medium text-slate-800">{(s.product as { name?: string })?.name ?? '—'}</div>
                    <div className="text-xs text-slate-400">{(s.product as { vendor?: { name?: string } })?.vendor?.name ?? ''}</div>
                  </div>
                ),
              },
              {
                key: 'qty',
                header: 'Qty',
                align: 'right',
                sortable: true,
                sortValue: (s) => Number(s.qty_sold),
                render: (s) => <span className="text-slate-600 tabular-nums">{formatNumber(s.qty_sold)}</span>,
              },
              {
                key: 'total',
                header: 'Total',
                align: 'right',
                sortable: true,
                sortValue: (s) => Number(s.total_sales),
                render: (s) => <span className="font-semibold text-slate-800 tabular-nums">{formatGHS(Number(s.total_sales))}</span>,
              },
            ]}
          />
        </WidgetCard>

        <WidgetCard title="Vendor Balances" href="/dashboard/payouts" linkLabel="Process payouts">
          <DashboardSortableTable
            rows={vendorBalances.slice(0, 8)}
            rowKey={(v) => v.vendor_id}
            empty={
              <DashboardEmptyState icon={Users} title="No vendor balances yet" description="Balances appear after sales and payouts are recorded." />
            }
            columns={[
              {
                key: 'vendor',
                header: 'Vendor',
                sortable: true,
                sortValue: (v) => v.vendor_name,
                render: (v) => (
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-[10px] font-bold shrink-0">
                      {v.vendor_name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="font-medium text-slate-800">{v.vendor_name}</span>
                  </div>
                ),
              },
              {
                key: 'momo',
                header: 'MoMo',
                sortable: true,
                sortValue: (v) => `${v.momo_network} ${v.momo_number}`,
                render: (v) => (
                  <span className="text-xs text-slate-500">{v.momo_network} · {v.momo_number}</span>
                ),
              },
              {
                key: 'balance',
                header: 'Balance',
                align: 'right',
                sortable: true,
                sortValue: (v) => v.balance,
                render: (v) => (
                  <span className={cn('font-semibold tabular-nums', v.balance > 0 ? 'text-amber-600' : 'text-brand-600')}>
                    {formatGHS(v.balance)}
                  </span>
                ),
              },
            ]}
          />
        </WidgetCard>
      </div>

      {/* Analytics tables */}
      <div className="grid lg:grid-cols-2 gap-6">
        <WidgetCard title="Least selling products" icon={TrendingDown} iconClass="text-amber-500" href="/dashboard/reports" linkLabel="Reports">
          <DashboardSortableTable
            rows={bottomProducts}
            rowKey={(p) => p.product_id}
            empty={<DashboardEmptyState icon={TrendingDown} title="No sales data in this period" className="py-8" />}
            columns={[
              { key: 'name', header: 'Product', sortable: true, sortValue: (p) => p.product_name, render: (p) => <span className="font-medium text-slate-800">{p.product_name}</span> },
              { key: 'qty', header: 'Units', align: 'right', sortable: true, sortValue: (p) => p.total_qty, render: (p) => <span className="tabular-nums text-slate-600">{formatNumber(p.total_qty)}</span> },
              { key: 'sales', header: 'Sales', align: 'right', sortable: true, sortValue: (p) => p.total_sales, render: (p) => <span className="tabular-nums font-medium text-slate-700">{formatGHS(p.total_sales)}</span> },
            ]}
          />
        </WidgetCard>

        <WidgetCard title="Most returned products" icon={RotateCcw} iconClass="text-red-500" href="/dashboard/returns" linkLabel="Returns">
          <DashboardSortableTable
            rows={topReturnedProducts}
            rowKey={(r) => r.product_id}
            empty={
              <DashboardEmptyState
                icon={PackageOpen}
                title="No returns recorded yet"
                description="Returns will appear here once products are logged as returned."
              />
            }
            columns={[
              { key: 'name', header: 'Product', sortable: true, sortValue: (r) => r.product_name, render: (r) => <span className="font-medium text-slate-800">{r.product_name}</span> },
              { key: 'qty', header: 'Units', align: 'right', sortable: true, sortValue: (r) => r.total_quantity_returned, render: (r) => <span className="tabular-nums">{formatNumber(r.total_quantity_returned)}</span> },
              { key: 'count', header: 'Returns', align: 'right', sortable: true, sortValue: (r) => r.return_count, render: (r) => <span className="tabular-nums text-slate-600">{r.return_count}</span> },
            ]}
          />
        </WidgetCard>

        <WidgetCard title="Vendors bringing most stock" icon={Inbox} iconClass="text-emerald-500" href="/dashboard/receiving" linkLabel="Receiving">
          <DashboardSortableTable
            rows={topVendorsByIntake}
            rowKey={(v) => v.vendor_id}
            empty={<DashboardEmptyState icon={Inbox} title="No intake data in this period" className="py-8" />}
            columns={[
              { key: 'vendor', header: 'Vendor', sortable: true, sortValue: (v) => v.vendor_name, render: (v) => <span className="font-medium text-slate-800">{v.vendor_name}</span> },
              { key: 'days', header: 'Delivery days', align: 'right', sortable: true, sortValue: (v) => v.receiving_days, render: (v) => <span className="tabular-nums text-slate-600">{formatNumber(v.receiving_days)}</span> },
              { key: 'units', header: 'Units', align: 'right', sortable: true, sortValue: (v) => v.total_quantity_received, render: (v) => <span className="tabular-nums text-slate-600">{formatNumber(v.total_quantity_received)}</span> },
              { key: 'value', header: 'Intake value', align: 'right', sortable: true, sortValue: (v) => v.total_intake_value, render: (v) => <span className="tabular-nums font-semibold text-slate-800">{formatGHS(v.total_intake_value)}</span> },
            ]}
          />
        </WidgetCard>

        <WidgetCard title="Top supermarkets by sales" icon={Building2} iconClass="text-blue-500" href="/dashboard/sales" linkLabel="Sales">
          <DashboardSortableTable
            rows={topSupermarkets}
            rowKey={(s) => s.supermarket_id}
            empty={<DashboardEmptyState icon={Building2} title="No supermarket sales in this period" className="py-8" />}
            columns={[
              {
                key: 'store',
                header: 'Outlet',
                sortable: true,
                sortValue: (s) => formatSupermarketLabel({ name: s.supermarket_name, branch: s.supermarket_branch }),
                render: (s) => (
                  <div>
                    <div className="font-medium text-slate-800">
                      {formatSupermarketLabel({ name: s.supermarket_name, branch: s.supermarket_branch })}
                    </div>
                    {s.supermarket_branch ? (
                      <div className="text-xs text-slate-400">{s.supermarket_name}</div>
                    ) : null}
                  </div>
                ),
              },
              { key: 'qty', header: 'Units', align: 'right', sortable: true, sortValue: (s) => s.total_qty, render: (s) => <span className="tabular-nums text-slate-600">{formatNumber(s.total_qty)}</span> },
              { key: 'sales', header: 'Sales', align: 'right', sortable: true, sortValue: (s) => s.total_sales, render: (s) => <span className="tabular-nums font-semibold text-slate-800">{formatGHS(s.total_sales)}</span> },
            ]}
          />
        </WidgetCard>
      </div>
    </div>
  )
}
