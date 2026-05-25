'use client'



import { useEffect, useState, useRef } from 'react'

import Link from 'next/link'

import { useSession } from '@/hooks/useSession'

import { vendorService } from '@/services/vendor.service'

import {

  ArrowLeft,

  FileText,

  Loader2,

  AlertCircle,

  Download,

  Printer,

} from 'lucide-react'

import { formatGHS, formatDate, downloadBlob } from '@/lib/utils'

import { printReport } from '@/lib/print'

import { format, startOfMonth, endOfMonth } from 'date-fns'



export default function VendorStatementPage() {

  const { vendorId, loading: sessionLoading } = useSession({

    requireAuth: true,

    ensureVendorProfile: true,

  })

  const [vendorName, setVendorName] = useState<string>('')

  const [from, setFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))

  const [to, setTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'))

  const [data, setData] = useState<{

    sales: { total_sales: number; commission_amount: number; vendor_due: number }[]

    returns: { quantity_returned: number; unit_price: number; vendor_price: number }[]

    payouts: { amount_paid: number }[]

  } | null>(null)

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  const statementRef = useRef<HTMLDivElement>(null)



  useEffect(() => {

    if (sessionLoading) return

    if (!vendorId) {

      setLoading(false)

      setError('No vendor linked to your account.')

      return

    }

    vendorService.getById(vendorId).then((v) => {

      setVendorName((v as { name?: string })?.name ?? '')

    })

  }, [sessionLoading, vendorId])



  useEffect(() => {

    if (sessionLoading || !vendorId) return

    setLoading(true)

    setError(null)

    vendorService

      .getVendorStatement(vendorId, from, to)

      .then(setData)

      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load statement'))

      .finally(() => setLoading(false))

  }, [sessionLoading, vendorId, from, to])



  const earningsFromSales = data

    ? data.sales.reduce((s, r) => s + Number(r.vendor_due ?? 0), 0)

    : 0

  const returnsAtAgreedPrice = data

    ? data.returns.reduce((s, r) => {

        const qty = Number(r.quantity_returned ?? 0)

        const vp = Number(r.vendor_price ?? 0)

        return s + qty * vp

      }, 0)

    : 0

  const payoutsTotal = data

    ? data.payouts.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0)

    : 0

  const netEarnings = earningsFromSales - returnsAtAgreedPrice - payoutsTotal



  const handleExportCSV = () => {

    const rows: string[][] = [

      ['DistroGH Vendor Statement'],

      ['Vendor', vendorName],

      ['Period', `${formatDate(from)} – ${formatDate(to)}`],

      [],

      ['Summary'],

      ['Earnings from sales (agreed price)', earningsFromSales.toFixed(2)],

      ['Returns (at agreed price)', (-returnsAtAgreedPrice).toFixed(2)],

      ['Payouts received', (-payoutsTotal).toFixed(2)],

      ['Net earnings (period)', netEarnings.toFixed(2)],

    ]

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })

    const filename = `statement_${from}_${to}.csv`

    downloadBlob(blob, filename)

  }



  const handlePrint = () => printReport('report-print-area')



  if (error || (vendorId == null && !loading)) {

    return (

      <div className="page-container">

        <div className="data-card text-center py-12">

          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />

          <p className="text-slate-700 font-medium">{error || 'Unable to load statement'}</p>

          <Link href="/dashboard/vendor" className="mt-4 inline-block text-brand-600 hover:text-brand-700 text-sm font-medium">

            ← Back to dashboard

          </Link>

        </div>

      </div>

    )

  }



  return (

    <div className="page-container space-y-6">

      <div className="no-print flex flex-wrap items-center justify-between gap-4">

        <div className="flex items-center gap-4">

          <Link

            href="/dashboard/vendor/payouts"

            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"

            aria-label="Back to payouts"

          >

            <ArrowLeft className="w-5 h-5" />

          </Link>

          <div>

            <h1 className="font-display text-2xl font-bold text-slate-900">Statement</h1>

            <p className="text-slate-500 text-sm mt-0.5">Earnings at your agreed price, returns, and payouts</p>

          </div>

        </div>

        <div className="flex items-center gap-2 print:hidden">

          <label className="text-sm text-slate-600">From</label>

          <input

            type="date"

            value={from}

            onChange={(e) => setFrom(e.target.value)}

            className="form-input w-40"

          />

          <label className="text-sm text-slate-600">To</label>

          <input

            type="date"

            value={to}

            onChange={(e) => setTo(e.target.value)}

            className="form-input w-40"

          />

        </div>

      </div>



      {loading ? (

        <div className="data-card flex items-center justify-center py-16">

          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />

        </div>

      ) : (

        <div ref={statementRef} className="space-y-6">

          <div id="report-print-area" className="print-area data-card print:shadow-none print:border print:border-slate-200">

            <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">

              <FileText className="w-6 h-6 text-emerald-600" />

              <h2 className="font-display font-semibold text-slate-900">Vendor Statement</h2>

            </div>

            <div className="grid gap-4 text-sm">

              <div className="flex gap-8">

                <span className="text-slate-500 w-32">Vendor</span>

                <span className="font-medium text-slate-900">{vendorName}</span>

              </div>

              <div className="flex gap-8">

                <span className="text-slate-500 w-32">Period</span>

                <span className="font-medium text-slate-900">

                  {formatDate(from)} – {formatDate(to)}

                </span>

              </div>

            </div>



            <div className="mt-8 overflow-x-auto">

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

            </div>



            <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500">

              <p>

                All amounts use the price you agreed with DistroGH per product. Supermarket markups are not shown on

                your statement.

              </p>

              <p className="mt-1">

                Sales lines: {data?.sales.length ?? 0} · Returns: {data?.returns.length ?? 0} · Payouts:{' '}

                {data?.payouts.length ?? 0}

              </p>

            </div>

          </div>



          <div className="flex flex-wrap gap-3 print:hidden">

            <button

              type="button"

              onClick={handleExportCSV}

              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"

            >

              <Download className="w-4 h-4" />

              Export CSV

            </button>

            <button

              type="button"

              onClick={handlePrint}

              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"

            >

              <Printer className="w-4 h-4" />

              Print / Save as PDF

            </button>

          </div>

        </div>

      )}



    </div>

  )

}


