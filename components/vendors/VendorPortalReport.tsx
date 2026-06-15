'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FileText, Loader2, Download, Printer, TrendingUp, Package } from 'lucide-react'
import { vendorService } from '@/services/vendor.service'
import { formatGHS, formatGHSChartAxis, formatDate, formatSalesPeriod, salesPeriodMonthKey, normalizeSaleMonthPeriod, downloadBlob } from '@/lib/utils'
import { printReport } from '@/lib/print'
import { VendorAccessBadge } from '@/components/vendors/VendorAccessBadge'
import type { VendorAccessMode } from '@/types'

interface SaleRow {
  vendor_due: number
  week_start: string
  week_end: string
  qty_sold: number
  product?: { name?: string; vendor_price?: number }
}

interface VendorPortalReportProps {
  vendorId: string
  vendorName: string
  contactPersonName?: string | null
  accessMode?: VendorAccessMode | null
  previewLabel?: string
}

function filterSalesByRange(sales: SaleRow[], from: string, to: string): SaleRow[] {
  return sales.filter((s) => s.week_start <= to && s.week_end >= from)
}

export function VendorPortalReport({
  vendorId,
  vendorName,
  contactPersonName,
  accessMode,
  previewLabel = 'Vendor portal preview — same earnings view as the partner statement',
}: VendorPortalReportProps) {
  const [from, setFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [statement, setStatement] = useState<{
    sales: { vendor_due: number }[]
    returns: { quantity_returned: number; vendor_price: number }[]
    payouts: { amount_paid: number }[]
  } | null>(null)
  const [salesRows, setSalesRows] = useState<SaleRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      vendorService.getVendorStatement(vendorId, from, to),
      vendorService.getVendorSales(vendorId),
    ])
      .then(([stmt, sales]) => {
        setStatement(stmt)
        setSalesRows((sales ?? []) as SaleRow[])
      })
      .catch(() => {
        setStatement(null)
        setSalesRows([])
      })
      .finally(() => setLoading(false))
  }, [vendorId, from, to])

  const earningsFromSales = statement
    ? statement.sales.reduce((s, r) => s + Number(r.vendor_due ?? 0), 0)
    : 0
  const returnsAtAgreedPrice = statement
    ? statement.returns.reduce((s, r) => s + Number(r.quantity_returned ?? 0) * Number(r.vendor_price ?? 0), 0)
    : 0
  const payoutsTotal = statement
    ? statement.payouts.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0)
    : 0
  const netEarnings = earningsFromSales - returnsAtAgreedPrice - payoutsTotal

  const filteredSales = useMemo(
    () => filterSalesByRange(salesRows, from, to),
    [salesRows, from, to]
  )

  const weeklyChart = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of filteredSales) {
      const monthKey = s.week_start ? salesPeriodMonthKey(s.week_start) : ''
      if (!monthKey) continue
      map.set(monthKey, (map.get(monthKey) ?? 0) + Number(s.vendor_due ?? 0))
    }
    return Array.from(map.entries())
      .map(([monthKey, earnings]) => {
        const { week_start, week_end } = normalizeSaleMonthPeriod(`${monthKey}-01`)
        return { week: formatSalesPeriod(week_start, week_end), earnings }
      })
      .sort((a, b) => a.week.localeCompare(b.week))
  }, [filteredSales])

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; earnings: number }>()
    for (const s of filteredSales) {
      const name = s.product?.name ?? 'Unknown'
      const cur = map.get(name) ?? { name, qty: 0, earnings: 0 }
      cur.qty += Number(s.qty_sold ?? 0)
      cur.earnings += Number(s.vendor_due ?? 0)
      map.set(name, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.earnings - a.earnings).slice(0, 5)
  }, [filteredSales])

  const handleExportCSV = () => {
    const rows: string[][] = [
      ['DistroGH Vendor Statement'],
      ['Vendor', vendorName],
      ...(contactPersonName ? [['Contact', contactPersonName]] : []),
      ['Period', `${formatDate(from)} – ${formatDate(to)}`],
      [],
      ['Summary'],
      ['Earnings from sales (agreed price)', earningsFromSales.toFixed(2)],
      ['Returns (at agreed price)', (-returnsAtAgreedPrice).toFixed(2)],
      ['Payouts received', (-payoutsTotal).toFixed(2)],
      ['Net earnings (period)', netEarnings.toFixed(2)],
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `vendor_report_${from}_${to}.csv`)
  }

  if (loading) {
    return (
      <div className="data-card flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-slate-600 max-w-xl">{previewLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="form-input w-40" />
          <label className="text-sm text-slate-600">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="form-input w-40" />
        </div>
      </div>

      <div id="vendor-portal-report-area" className="space-y-6 print-area">
        <div className="data-card print:shadow-none print:border print:border-slate-200">
          <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-slate-100">
            <FileText className="w-6 h-6 text-emerald-600" />
            <h2 className="font-display font-semibold text-slate-900">Vendor Statement</h2>
            {accessMode && <VendorAccessBadge accessMode={accessMode} />}
          </div>
          <div className="grid gap-3 text-sm mb-6">
            <div className="flex gap-8">
              <span className="text-slate-500 w-32">Vendor</span>
              <span className="font-medium text-slate-900">{vendorName}</span>
            </div>
            {contactPersonName ? (
              <div className="flex gap-8">
                <span className="text-slate-500 w-32">Contact</span>
                <span className="font-medium text-slate-900">{contactPersonName}</span>
              </div>
            ) : null}
            <div className="flex gap-8">
              <span className="text-slate-500 w-32">Period</span>
              <span className="font-medium text-slate-900">
                {formatDate(from)} – {formatDate(to)}
              </span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 font-semibold text-slate-700">Item</th>
                <th className="text-right py-3 font-semibold text-slate-700">Amount (GHS)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-3 text-slate-700 font-medium">Earnings from sales (agreed price)</td>
                <td className="text-right font-mono font-semibold">{formatGHS(earningsFromSales)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-3 text-slate-600">Returns (at agreed price)</td>
                <td className="text-right font-mono text-slate-600">-{formatGHS(returnsAtAgreedPrice)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-3 text-slate-600">Payouts received</td>
                <td className="text-right font-mono text-slate-600">-{formatGHS(payoutsTotal)}</td>
              </tr>
              <tr>
                <td className="py-4 text-slate-900 font-semibold">Net earnings (this period)</td>
                <td className="text-right font-mono font-bold text-emerald-700">{formatGHS(netEarnings)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500">
            All amounts use your agreed price per product. DistroGH markup and admin adjustments are not shown here.
          </p>
        </div>

        {topProducts.length > 0 && (
          <div className="data-card print:shadow-none print:border print:border-slate-200">
            <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              Top products (by your earnings)
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 font-semibold text-slate-700">Product</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Qty sold</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Your earnings</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p) => (
                  <tr key={p.name} className="border-b border-slate-100">
                    <td className="py-2 text-slate-800">{p.name}</td>
                    <td className="text-right font-mono text-slate-600">{p.qty}</td>
                    <td className="text-right font-mono font-medium">{formatGHS(p.earnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {weeklyChart.length > 0 && (
          <div className="data-card print:hidden">
            <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              Weekly earnings trend
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={formatGHSChartAxis} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip formatter={(v: number) => formatGHS(v)} />
                  <Bar dataKey="earnings" fill="#059669" radius={[4, 4, 0, 0]} name="Earnings" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 print:hidden">
        <button
          type="button"
          onClick={handleExportCSV}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => printReport('vendor-portal-report-area')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
        >
          <Printer className="w-4 h-4" />
          Print / Save as PDF
        </button>
      </div>
    </div>
  )
}
