'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfQuarter,
  endOfQuarter,
  startOfDay,
} from 'date-fns'
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
import { salesService } from '@/services/sales.service'
import { returnsService } from '@/services/returns.service'
import { deliveryService } from '@/services/delivery.service'
import { useSession } from '@/hooks/useSession'
import { formatGHS, formatGHSChartAxis, formatDate, formatSalesPeriod, cn } from '@/lib/utils'
import { aggregateSalesToReport, applyReturnDeductions } from '@/lib/report-utils'
import {
  AlertCircle,
  BarChart3,
  Printer,
  FileText,
  Package,
  Users,
  TrendingUp,
  Loader2,
  Truck,
} from 'lucide-react'
import type { WeeklyRevenue, ProductPerformance, VendorSalesBreakdown, DashboardKPIs } from '@/types'
import { printReport } from '@/lib/print'

const CHART_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#d97706', '#dc2626']

type DatePresetKey = 'this_week' | 'this_month' | 'last_7' | 'last_30' | 'quarter' | 'custom'
type ReportTypeKey = 'sales' | 'products' | 'vendors' | 'delivery' | 'full'

const DATE_PRESETS: { key: DatePresetKey; label: string; getRange: () => { start: string; end: string } }[] = [
  {
    key: 'this_week',
    label: 'This week',
    getRange: () => {
      const start = startOfWeek(new Date(), { weekStartsOn: 1 })
      const end = endOfWeek(new Date(), { weekStartsOn: 1 })
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'this_month',
    label: 'This month',
    getRange: () => {
      const start = startOfMonth(new Date())
      const end = endOfMonth(new Date())
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'last_7',
    label: 'Last 7 days',
    getRange: () => {
      const end = startOfDay(new Date())
      const start = subDays(end, 6)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'last_30',
    label: 'Last 30 days',
    getRange: () => {
      const end = startOfDay(new Date())
      const start = subDays(end, 29)
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  {
    key: 'quarter',
    label: 'Quarter to date',
    getRange: () => {
      const start = startOfQuarter(new Date())
      const end = endOfQuarter(new Date())
      return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') }
    },
  },
  { key: 'custom', label: 'Custom range', getRange: () => ({ start: '', end: '' }) },
]

const REPORT_TYPES: { key: ReportTypeKey; label: string; icon: typeof FileText }[] = [
  { key: 'sales', label: 'Sales report', icon: TrendingUp },
  { key: 'products', label: 'Products report', icon: Package },
  { key: 'vendors', label: 'Vendors report', icon: Users },
  { key: 'delivery', label: 'Delivery / Transport', icon: Truck },
  { key: 'full', label: 'Full summary', icon: FileText },
]

export default function ReportsPage() {
  useSession({ redirectVendorFromAdmin: true })
  const [datePreset, setDatePreset] = useState<DatePresetKey>('this_month')
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [reportType, setReportType] = useState<ReportTypeKey>('full')
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

  const getStartEnd = useCallback((): { start: string; end: string } => {
    if (datePreset === 'custom') return { start: customStart, end: customEnd }
    const preset = DATE_PRESETS.find(p => p.key === datePreset)
    return preset ? preset.getRange() : { start: customStart, end: customEnd }
  }, [datePreset, customStart, customEnd])

  const loadReport = useCallback(async () => {
    const { start, end } = getStartEnd()
    if (!start || !end) {
      setError('Please select a date range.')
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [getStartEnd])

  useEffect(() => {
    loadReport()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  const handlePrint = () => printReport('report-print-area')

  const totalSales = kpis?.totalSales ?? 0
  const totalMarkup = kpis?.totalCommission ?? 0
  const totalVendorDue = kpis?.totalVendorDue ?? 0

  const weeklyChartData = weekly.map(w => ({
    week: formatSalesPeriod(w.week_start, w.week_end),
    'Total Sales': Number(w.total_sales),
    Markup: Number(w.total_commission),
    'Vendor Due': Number(w.total_vendor_due),
  }))

  const vendorChartData = vendors.map(v => ({
    name: v.vendor_name.length > 14 ? v.vendor_name.slice(0, 14) + '…' : v.vendor_name,
    Sales: v.total_sales,
    'Vendor Due': v.total_vendor_due,
  }))

  const productPieData = products.slice(0, 8).map(p => ({
    name: p.product_name.length > 18 ? p.product_name.slice(0, 18) + '…' : p.product_name,
    value: p.total_sales,
  }))

  const showSales = reportType === 'sales' || reportType === 'full'
  const showProducts = reportType === 'products' || reportType === 'full'
  const showVendors = reportType === 'vendors' || reportType === 'full'
  const showDelivery = reportType === 'delivery' || reportType === 'full'

  const deliveryChartData = (transportReport?.bySupermarket ?? []).map(r => ({
    name: r.supermarket_name.length > 14 ? r.supermarket_name.slice(0, 14) + '…' : r.supermarket_name,
    'Transport cost': r.total_transport_cost,
  }))

  return (
      <div className="page-container space-y-6 animate-fade-in reports-page">
        {/* Toolbar - no print */}
        <div className="no-print space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
                Reports &amp; Analytics
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Generate and print reports by date range
              </p>
            </div>
          </div>

          {/* Date range & report type */}
          <div className="data-card flex flex-col sm:flex-row flex-wrap gap-4 items-start sm:items-end">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Period</label>
                <div className="flex flex-wrap gap-2">
                  {DATE_PRESETS.map(p => (
                    <button
                      key={p.key}
                      onClick={() => setDatePreset(p.key)}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm font-medium transition-all',
                        datePreset === p.key
                          ? 'bg-emerald-600 text-white shadow-md'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {datePreset === 'custom' && (
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
                    <input
                      type="date"
                      value={customStart}
                      onChange={e => setCustomStart(e.target.value)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={e => setCustomEnd(e.target.value)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
              <button
                onClick={loadReport}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                {loading ? 'Loading…' : 'Generate report'}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-slate-500">Report type:</span>
              {REPORT_TYPES.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setReportType(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                    reportType === key
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-transparent'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl ml-auto print:hidden"
            >
              <Printer className="w-4 h-4" />
              Print report
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Report content - print area */}
        <div id="report-print-area" className="space-y-6">
          {/* Report header for print */}
          <div className="data-card border-b-2 border-slate-200 pb-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">DistroGH — Distribution Report</h2>
                <p className="text-slate-600 text-sm mt-1">
                  {rangeLabel || 'Select period and generate'}
                </p>
                <p className="text-slate-400 text-xs mt-0.5">
                  Generated on {format(new Date(), 'dd MMM yyyy, HH:mm')}
                </p>
              </div>
              <div className="flex gap-4">
                {[
                  { label: 'Total sales', value: formatGHS(totalSales), color: 'text-blue-600' },
                  { label: 'Total Markup', value: formatGHS(totalMarkup), color: 'text-violet-600' },
                  { label: 'Vendor payables', value: formatGHS(totalVendorDue), color: 'text-emerald-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-right">
                    <p className={cn('text-lg font-bold', color)}>{value}</p>
                    <p className="text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="no-print data-card flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* Sales report */}
              {showSales && (
                <div className="data-card">
                  <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    Sales summary
                  </h3>
                  {weekly.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6">No sales data in this period.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto mb-6">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Month</th>
                              <th className="text-right">Total sales</th>
                              <th className="text-right">Markup</th>
                              <th className="text-right">Vendor due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {weekly.map(w => (
                              <tr key={w.week_start}>
                                <td className="font-medium">{formatSalesPeriod(w.week_start, w.week_end)}</td>
                                <td className="text-right font-mono">{formatGHS(Number(w.total_sales))}</td>
                                <td className="text-right font-mono text-violet-600">{formatGHS(Number(w.total_commission))}</td>
                                <td className="text-right font-mono text-emerald-600">{formatGHS(Number(w.total_vendor_due))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="h-64 print-hide-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={weeklyChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                            <Tooltip formatter={(v: number, name: string) => [formatGHS(v), name]} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Area type="monotone" dataKey="Total Sales" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} strokeWidth={2} />
                            <Area type="monotone" dataKey="Vendor Due" stroke="#16a34a" fill="#16a34a" fillOpacity={0.2} strokeWidth={2} />
                            <Line type="monotone" dataKey="Markup" stroke="#7c3aed" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Products report */}
              {showProducts && (
                <div className="data-card">
                  <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-600" />
                    Products performance
                  </h3>
                  {products.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6">No product data in this period.</p>
                  ) : (
                    <div className="grid lg:grid-cols-2 gap-8">
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Product</th>
                              <th>Vendor</th>
                              <th className="text-right">Qty</th>
                              <th className="text-right">Sales</th>
                            </tr>
                          </thead>
                          <tbody>
                            {products.map((p, i) => (
                              <tr key={p.product_id}>
                                <td className="text-slate-400 font-mono text-xs">{i + 1}</td>
                                <td className="font-medium">{p.product_name}</td>
                                <td className="text-slate-600 text-sm">{p.vendor_name}</td>
                                <td className="text-right font-mono">{p.total_qty}</td>
                                <td className="text-right font-mono font-semibold">{formatGHS(p.total_sales)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {productPieData.length > 0 && (
                        <div className="h-64 print-hide-chart">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={productPieData}
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                innerRadius={40}
                                dataKey="value"
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              >
                                {productPieData.map((_, i) => (
                                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: number) => [formatGHS(v), 'Sales']} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Vendors report */}
              {showVendors && (
                <div className="data-card">
                  <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-amber-600" />
                    Vendors breakdown
                  </h3>
                  {vendors.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6">No vendor data in this period.</p>
                  ) : (
                    <>
                      <div className="h-64 mb-6 print-hide-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={vendorChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tickFormatter={formatGHSChartAxis} tick={{ fontSize: 11 }} />
                            <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
                            <Tooltip formatter={(v: number, name: string) => [formatGHS(v), name]} />
                            <Legend />
                            <Bar dataKey="Sales" fill="#2563eb" radius={[0, 4, 4, 0]} />
                            <Bar dataKey="Vendor Due" fill="#16a34a" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Vendor</th>
                              <th className="text-right">Total sales</th>
                              <th className="text-right">Markup</th>
                              <th className="text-right">Vendor due</th>
                              <th className="text-right">Share %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vendors.map((v, i) => (
                              <tr key={v.vendor_id}>
                                <td className="text-slate-400 font-mono text-xs">{i + 1}</td>
                                <td className="font-medium">{v.vendor_name}</td>
                                <td className="text-right font-mono">{formatGHS(v.total_sales)}</td>
                                <td className="text-right font-mono text-violet-600">{formatGHS(v.total_commission)}</td>
                                <td className="text-right font-mono text-emerald-600 font-semibold">{formatGHS(v.total_vendor_due)}</td>
                                <td className="text-right text-slate-500">
                                  {totalSales > 0 ? ((v.total_sales / totalSales) * 100).toFixed(1) : 0}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Delivery / Transport cost report */}
              {showDelivery && (
                <div className="data-card">
                  <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Truck className="w-5 h-5 text-slate-600" />
                    Delivery &amp; transport cost
                  </h3>
                  {!transportReport || (transportReport.bySupermarket.length === 0 && transportReport.total === 0) ? (
                    <p className="text-slate-500 text-sm py-6">No delivery runs or transport cost in this period.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-6 mb-6">
                        <div>
                          <p className="text-2xl font-bold text-emerald-700">{formatGHS(transportReport.total)}</p>
                          <p className="text-xs text-slate-500">Total transport cost (period)</p>
                        </div>
                      </div>
                      {deliveryChartData.length > 0 && (
                        <div className="h-64 mb-6 print-hide-chart">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={deliveryChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                              <XAxis type="number" tickFormatter={formatGHSChartAxis} tick={{ fontSize: 11 }} />
                              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(v: number) => [formatGHS(v), 'Transport cost']} />
                              <Bar dataKey="Transport cost" fill="#0891b2" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Supermarket</th>
                              <th className="text-right">Delivery runs</th>
                              <th className="text-right">Transport cost</th>
                              <th className="text-right">Share %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transportReport.bySupermarket.map((r, i) => (
                              <tr key={r.supermarket_id}>
                                <td className="text-slate-400 font-mono text-xs">{i + 1}</td>
                                <td className="font-medium">{r.supermarket_name}</td>
                                <td className="text-right font-mono">{r.run_count}</td>
                                <td className="text-right font-mono font-semibold text-emerald-700">{formatGHS(r.total_transport_cost)}</td>
                                <td className="text-right text-slate-500">
                                  {transportReport.total > 0 ? ((r.total_transport_cost / transportReport.total) * 100).toFixed(1) : 0}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
  )
}
