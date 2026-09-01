'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
  Line,
} from 'recharts'
import {
  AlertCircle,
  FileText,
  Package,
  Users,
  TrendingUp,
  Loader2,
  Truck,
  Printer,
  FileDown,
} from 'lucide-react'
import { salesService } from '@/services/sales.service'
import { returnsService } from '@/services/returns.service'
import { deliveryService } from '@/services/delivery.service'
import { useSession } from '@/hooks/useSession'
import { formatGHS, formatGHSChartAxis, formatDate, formatSalesPeriod, formatNumber } from '@/lib/utils'
import { formatDisplayName } from '@/lib/format-display-name'
import { aggregateSalesToReport, applyReturnDeductions } from '@/lib/report-utils'
import { resolveReportDateRange, type ReportDatePresetKey } from '@/lib/reports-date-range'
import { printReport } from '@/lib/print'
import { ReportsToolbar } from '@/components/reports/ReportsToolbar'
import { ReportTypeTabs, type ReportTypeKey } from '@/components/reports/ReportTypeTabs'
import { ReportDocumentHeader } from '@/components/reports/ReportDocumentHeader'
import { ReportSectionCard } from '@/components/reports/ReportSectionCard'
import { ReportDataTable, ReportTablePager, type TablePageSize } from '@/components/reports/ReportDataTable'
import { ReportChartCard } from '@/components/reports/ReportChartCard'
import { ReportEmptyState } from '@/components/reports/ReportEmptyState'
import type { WeeklyRevenue, ProductPerformance, VendorSalesBreakdown, DashboardKPIs } from '@/types'

const CHART_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#d97706', '#dc2626']

const REPORT_TYPES: { key: ReportTypeKey; label: string; icon: typeof FileText }[] = [
  { key: 'full', label: 'Full summary', icon: FileText },
  { key: 'sales', label: 'Sales', icon: TrendingUp },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'vendors', label: 'Vendors', icon: Users },
  { key: 'delivery', label: 'Delivery', icon: Truck },
]

export default function ReportsPage() {
  useSession({ redirectVendorFromAdmin: true })

  const [datePreset, setDatePreset] = useState<ReportDatePresetKey>('all_time')
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [reportType, setReportType] = useState<ReportTypeKey>('full')
  const [productPageSize, setProductPageSize] = useState<TablePageSize>(25)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weekly, setWeekly] = useState<WeeklyRevenue[]>([])
  const [products, setProducts] = useState<ProductPerformance[]>([])
  const [vendors, setVendors] = useState<VendorSalesBreakdown[]>([])
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [rangeLabel, setRangeLabel] = useState('')
  const [transportReport, setTransportReport] = useState<{
    total: number
    bySupermarket: { supermarket_id: string; supermarket_name: string; total_transport_cost: number; run_count: number }[]
  } | null>(null)

  const resolvedRange = useMemo(
    () => resolveReportDateRange(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd]
  )

  const rangeHint =
    datePreset !== 'custom' && resolvedRange.start && resolvedRange.end
      ? `${resolvedRange.start} — ${resolvedRange.end}`
      : undefined

  const loadReport = useCallback(async () => {
    const { start, end } = resolveReportDateRange(datePreset, customStart, customEnd)
    if (!start || !end) {
      setError('Please select a valid date range.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [sales, returns, transport] = await Promise.all([
        salesService.getSalesInDateRange(start, end),
        returnsService.getInDateRange(start, end),
        deliveryService.getTransportCostReport(start, end),
      ])
      const aggregated = aggregateSalesToReport(sales)
      const withDeductions = applyReturnDeductions(aggregated, returns)
      setWeekly(withDeductions.weekly)
      setProducts(withDeductions.products)
      setVendors(withDeductions.vendors)
      setKpis(withDeductions.kpis)
      setTransportReport(transport)
      setRangeLabel(`${formatDate(start)} – ${formatDate(end)}`)
      setGeneratedAt(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [datePreset, customStart, customEnd])

  useEffect(() => {
    loadReport()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- initial load only

  const handlePrint = () => printReport('report-print-area')

  const totalSales = kpis?.totalSales ?? 0
  const totalMarkup = kpis?.totalCommission ?? 0
  const totalVendorDue = kpis?.totalVendorDue ?? 0

  const weeklyChartData = weekly.map((w) => ({
    week: formatSalesPeriod(w.week_start, w.week_end),
    'Total Sales': Number(w.total_sales),
    Markup: Number(w.total_commission),
    'Vendor Due': Number(w.total_vendor_due),
  }))

  const vendorChartData = vendors.map((v) => ({
    name: formatDisplayName(v.vendor_name).length > 16
      ? `${formatDisplayName(v.vendor_name).slice(0, 16)}…`
      : formatDisplayName(v.vendor_name),
    Sales: v.total_sales,
    'Vendor Due': v.total_vendor_due,
  }))

  const productPieData = products.slice(0, 8).map((p) => ({
    name: formatDisplayName(p.product_name).length > 18
      ? `${formatDisplayName(p.product_name).slice(0, 18)}…`
      : formatDisplayName(p.product_name),
    value: p.total_sales,
  }))

  const visibleProducts = useMemo(() => {
    if (productPageSize === 'all') return products
    return products.slice(0, productPageSize)
  }, [products, productPageSize])

  const showSales = reportType === 'sales' || reportType === 'full'
  const showProducts = reportType === 'products' || reportType === 'full'
  const showVendors = reportType === 'vendors' || reportType === 'full'
  const showDelivery = reportType === 'delivery' || reportType === 'full'

  const deliveryChartData = (transportReport?.bySupermarket ?? []).map((r) => ({
    name: formatDisplayName(r.supermarket_name).length > 14
      ? `${formatDisplayName(r.supermarket_name).slice(0, 14)}…`
      : formatDisplayName(r.supermarket_name),
    'Transport cost': r.total_transport_cost,
  }))

  const chartTooltipStyle = {
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
  }

  return (
    <div className="page-container w-full max-w-7xl mx-auto space-y-6 animate-fade-in reports-page">
      {/* Page header + export actions */}
      <div className="no-print flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
            Reports &amp; Analytics
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Generate distribution reports by period and export for printing
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/20 hover:bg-brand-700 transition-colors"
          >
            <FileDown className="h-4 w-4" />
            Export PDF
          </button>
        </div>
      </div>

      <ReportsToolbar
        datePreset={datePreset}
        customStart={customStart}
        customEnd={customEnd}
        loading={loading}
        rangeHint={rangeHint}
        onPresetChange={setDatePreset}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        onGenerate={loadReport}
      />

      <ReportTypeTabs value={reportType} onChange={setReportType} options={REPORT_TYPES} />

      {error ? (
        <div className="no-print flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : null}

      <div id="report-print-area" className="space-y-6">
        <ReportDocumentHeader
          rangeLabel={rangeLabel}
          generatedAt={generatedAt ?? undefined}
          totalSales={totalSales}
          totalMarkup={totalMarkup}
          totalVendorDue={totalVendorDue}
        />

        {loading ? (
          <div className="no-print data-card flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          </div>
        ) : (
          <>
            {showSales ? (
              <ReportSectionCard title="Sales summary" icon={TrendingUp} iconClass="text-emerald-600">
                {weekly.length === 0 ? (
                  <ReportEmptyState
                    icon={TrendingUp}
                    title="No sales in this period"
                    description="Try a wider date range or import sales data for the selected window."
                    actionLabel="Import sales"
                    actionHref="/dashboard/sales/import"
                  />
                ) : (
                  <div className="space-y-5">
                    <ReportDataTable
                      rows={weekly}
                      rowKey={(w) => w.week_start}
                      columns={[
                        {
                          key: 'month',
                          header: 'Month',
                          render: (w) => (
                            <span className="font-medium text-slate-800">
                              {formatSalesPeriod(w.week_start, w.week_end)}
                            </span>
                          ),
                        },
                        {
                          key: 'sales',
                          header: 'Total sales',
                          align: 'right',
                          render: (w) => formatGHS(Number(w.total_sales)),
                        },
                        {
                          key: 'markup',
                          header: 'Markup',
                          align: 'right',
                          render: (w) => (
                            <span className="text-violet-600">{formatGHS(Number(w.total_commission))}</span>
                          ),
                        },
                        {
                          key: 'due',
                          header: 'Vendor due',
                          align: 'right',
                          render: (w) => (
                            <span className="font-semibold text-emerald-600">
                              {formatGHS(Number(w.total_vendor_due))}
                            </span>
                          ),
                        },
                      ]}
                    />
                    <ReportChartCard title="Sales trend" subtitle="Monthly totals in selected period">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={weeklyChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                          <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number, name: string) => [formatGHS(v), name]} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area type="monotone" dataKey="Total Sales" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} strokeWidth={2} />
                          <Area type="monotone" dataKey="Vendor Due" stroke="#16a34a" fill="#16a34a" fillOpacity={0.15} strokeWidth={2} />
                          <Line type="monotone" dataKey="Markup" stroke="#7c3aed" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ReportChartCard>
                  </div>
                )}
              </ReportSectionCard>
            ) : null}

            {showProducts ? (
              <ReportSectionCard title="Products performance" icon={Package} iconClass="text-blue-600">
                {products.length === 0 ? (
                  <ReportEmptyState
                    icon={Package}
                    title="No product sales in this period"
                    description="Product rankings appear once sales are recorded for the selected dates."
                    actionLabel="View sales"
                    actionHref="/dashboard/sales"
                  />
                ) : (
                  <div className="space-y-4">
                    <ReportTablePager
                      total={products.length}
                      pageSize={productPageSize}
                      onPageSizeChange={setProductPageSize}
                    />
                    <div className="grid gap-6 xl:grid-cols-2">
                      <ReportDataTable
                        stickyHeader
                        maxHeight="28rem"
                        rows={visibleProducts}
                        rowKey={(p) => p.product_id}
                        columns={[
                          {
                            key: 'rank',
                            header: '#',
                            align: 'center',
                            className: 'w-10',
                            render: (_, i) => <span className="text-xs text-slate-400">{i + 1}</span>,
                          },
                          {
                            key: 'product',
                            header: 'Product',
                            render: (p) => (
                              <span className="font-medium text-slate-800">{formatDisplayName(p.product_name)}</span>
                            ),
                          },
                          {
                            key: 'vendor',
                            header: 'Vendor',
                            render: (p) => (
                              <span className="text-sm text-slate-600">{formatDisplayName(p.vendor_name)}</span>
                            ),
                          },
                          {
                            key: 'qty',
                            header: 'Qty',
                            align: 'right',
                            render: (p) => formatNumber(p.total_qty),
                          },
                          {
                            key: 'sales',
                            header: 'Sales',
                            align: 'right',
                            render: (p) => <span className="font-semibold">{formatGHS(p.total_sales)}</span>,
                          },
                        ]}
                      />
                      {productPieData.length > 0 ? (
                        <ReportChartCard title="Share of sales" subtitle="Top 8 products by value">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={productPieData}
                                cx="50%"
                                cy="50%"
                                outerRadius={90}
                                innerRadius={48}
                                dataKey="value"
                                paddingAngle={2}
                              >
                                {productPieData.map((_, i) => (
                                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [formatGHS(v), 'Sales']} />
                              <Legend wrapperStyle={{ fontSize: 11 }} />
                            </PieChart>
                          </ResponsiveContainer>
                        </ReportChartCard>
                      ) : null}
                    </div>
                  </div>
                )}
              </ReportSectionCard>
            ) : null}

            {showVendors ? (
              <ReportSectionCard title="Vendors breakdown" icon={Users} iconClass="text-amber-600">
                {vendors.length === 0 ? (
                  <ReportEmptyState
                    icon={Users}
                    title="No vendor sales in this period"
                    description="Vendor breakdowns require sales activity in the selected date window."
                  />
                ) : (
                  <div className="space-y-5">
                    <ReportChartCard title="Sales by vendor" subtitle="Total sales vs vendor due">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={vendorChartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tickFormatter={formatGHSChartAxis} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                          <YAxis dataKey="name" type="category" width={108} tick={{ fontSize: 10, fill: '#64748b' }} />
                          <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number, name: string) => [formatGHS(v), name]} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="Sales" fill="#2563eb" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="Vendor Due" fill="#16a34a" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ReportChartCard>
                    <ReportDataTable
                      rows={vendors}
                      rowKey={(v) => v.vendor_id}
                      columns={[
                        {
                          key: 'rank',
                          header: '#',
                          align: 'center',
                          className: 'w-10',
                          render: (_, i) => <span className="text-xs text-slate-400">{i + 1}</span>,
                        },
                        {
                          key: 'vendor',
                          header: 'Vendor',
                          render: (v) => (
                            <span className="font-medium text-slate-800">{formatDisplayName(v.vendor_name)}</span>
                          ),
                        },
                        {
                          key: 'sales',
                          header: 'Total sales',
                          align: 'right',
                          render: (v) => formatGHS(v.total_sales),
                        },
                        {
                          key: 'markup',
                          header: 'Markup',
                          align: 'right',
                          render: (v) => <span className="text-violet-600">{formatGHS(v.total_commission)}</span>,
                        },
                        {
                          key: 'due',
                          header: 'Vendor due',
                          align: 'right',
                          render: (v) => (
                            <span className="font-semibold text-emerald-600">{formatGHS(v.total_vendor_due)}</span>
                          ),
                        },
                        {
                          key: 'share',
                          header: 'Share %',
                          align: 'right',
                          render: (v) => (
                            <span className="text-slate-500">
                              {totalSales > 0 ? ((v.total_sales / totalSales) * 100).toFixed(1) : '0.0'}%
                            </span>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </ReportSectionCard>
            ) : null}

            {showDelivery ? (
              <ReportSectionCard title="Delivery & transport cost" icon={Truck} iconClass="text-cyan-600">
                {!transportReport || (transportReport.bySupermarket.length === 0 && transportReport.total === 0) ? (
                  <ReportEmptyState
                    icon={Truck}
                    title="No delivery runs in this period"
                    description="Transport costs appear once delivery runs are logged with confirmed transport charges."
                    actionLabel="Schedule delivery"
                    actionHref="/dashboard/deliveries"
                  />
                ) : (
                  <div className="space-y-5">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                      <p className="text-2xl font-bold text-emerald-800">{formatGHS(transportReport.total)}</p>
                      <p className="text-xs text-emerald-700/80">Total transport cost for period</p>
                    </div>
                    {deliveryChartData.length > 0 ? (
                      <ReportChartCard title="Cost by supermarket">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={deliveryChartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tickFormatter={formatGHSChartAxis} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                            <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10, fill: '#64748b' }} />
                            <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [formatGHS(v), 'Transport cost']} />
                            <Bar dataKey="Transport cost" fill="#0891b2" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ReportChartCard>
                    ) : null}
                    <ReportDataTable
                      rows={transportReport.bySupermarket}
                      rowKey={(r) => r.supermarket_id}
                      columns={[
                        {
                          key: 'rank',
                          header: '#',
                          align: 'center',
                          className: 'w-10',
                          render: (_, i) => <span className="text-xs text-slate-400">{i + 1}</span>,
                        },
                        {
                          key: 'store',
                          header: 'Supermarket',
                          render: (r) => (
                            <span className="font-medium text-slate-800">{formatDisplayName(r.supermarket_name)}</span>
                          ),
                        },
                        {
                          key: 'runs',
                          header: 'Delivery runs',
                          align: 'right',
                          render: (r) => formatNumber(r.run_count),
                        },
                        {
                          key: 'cost',
                          header: 'Transport cost',
                          align: 'right',
                          render: (r) => (
                            <span className="font-semibold text-emerald-700">{formatGHS(r.total_transport_cost)}</span>
                          ),
                        },
                        {
                          key: 'share',
                          header: 'Share %',
                          align: 'right',
                          render: (r) => (
                            <span className="text-slate-500">
                              {transportReport.total > 0
                                ? ((r.total_transport_cost / transportReport.total) * 100).toFixed(1)
                                : '0.0'}
                              %
                            </span>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </ReportSectionCard>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
