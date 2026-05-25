'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/hooks/useSession'
import { vendorService } from '@/services/vendor.service'
import { ArrowLeft, CreditCard, Loader2, AlertCircle, Wallet, FileText } from 'lucide-react'
import { formatGHS, formatDate, cn } from '@/lib/utils'

interface PayoutRow {
  id: string
  amount_due: number
  amount_paid: number
  status: string
  payout_date: string | null
  week_start: string | null
  week_end: string | null
}

export default function VendorPayoutsPage() {
  const { vendorId, loading: sessionLoading } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [balance, setBalance] = useState<number | null>(null)
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionLoading) return
    if (!vendorId) {
      setLoading(false)
      setError('No vendor linked to your account.')
      return
    }
    Promise.all([
      vendorService.getVendorBalance(vendorId),
      vendorService.getVendorPayoutHistory(vendorId),
    ])
      .then(([bal, history]) => {
        setBalance(bal)
        setPayouts((history ?? []) as PayoutRow[])
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load payout history')
      })
      .finally(() => setLoading(false))
  }, [sessionLoading, vendorId])

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (error || vendorId == null) {
    return (
      <div className="page-container">
        <div className="data-card text-center py-12">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{error || 'Unable to load payout history'}</p>
          <Link href="/dashboard/vendor" className="mt-4 inline-block text-brand-600 hover:text-brand-700 text-sm font-medium">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/vendor"
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Payout history</h1>
          <p className="text-slate-500 text-sm mt-0.5">View your balance and payout records</p>
        </div>
      </div>

      {/* Balance card */}
      <div className="data-card bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-100">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-emerald-600" />
          </div>
          <span className="text-sm font-medium text-slate-600">Current balance</span>
        </div>
        <p className="text-3xl font-bold text-slate-900 font-mono">
          {formatGHS(balance ?? 0)}
        </p>
        <p className="text-slate-500 text-sm mt-1">
          Amount owed to you at your agreed product prices, minus returns and payouts already made.
        </p>
      </div>

      {/* Payout history table */}
      <div className="data-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-slate-500" />
          <h2 className="font-display font-semibold text-slate-900">Payout records</h2>
        </div>
        {payouts.length === 0 ? (
          <div className="px-4 py-12 text-center text-slate-500">
            <CreditCard className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-600">No payouts yet</p>
            <p className="text-sm mt-1">When payouts are processed, they will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Period</th>
                  <th className="text-right">Amount due</th>
                  <th className="text-right">Amount paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payout_date ? formatDate(p.payout_date) : '—'}</td>
                    <td className="text-slate-600 text-sm">
                      {p.week_start && p.week_end
                        ? `${formatDate(p.week_start)} – ${formatDate(p.week_end)}`
                        : '—'}
                    </td>
                    <td className="text-right font-mono">{formatGHS(Number(p.amount_due ?? 0))}</td>
                    <td className="text-right font-mono font-semibold text-emerald-700">
                      {formatGHS(Number(p.amount_paid ?? 0))}
                    </td>
                    <td>
                      <span
                        className={cn(
                          'inline-flex px-2 py-0.5 rounded-full text-xs font-medium',
                          p.status === 'completed' && 'bg-emerald-100 text-emerald-800',
                          p.status === 'pending' && 'bg-amber-100 text-amber-800',
                          p.status === 'processing' && 'bg-blue-100 text-blue-800',
                          p.status === 'failed' && 'bg-red-100 text-red-800'
                        )}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href="/dashboard/vendor/statement"
          className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium"
        >
          <FileText className="w-4 h-4" />
          Download statement (CSV / PDF)
        </Link>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">
          Payout details are sent to the MoMo number on your{' '}
          <Link href="/dashboard/vendor/profile" className="text-brand-600 hover:text-brand-700 font-medium">
            profile
          </Link>.
        </span>
      </div>
    </div>
  )
}
