'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/hooks/useSession'
import { vendorService } from '@/services/vendor.service'
import { requestVendorDeactivation, hasPendingDeactivationRequest } from '@/app/dashboard/vendor/actions'
import { ArrowLeft, PowerOff, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { formatGHS } from '@/lib/utils'

export default function RequestDeactivationPage() {
  const { vendorId, loading: sessionLoading } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [balance, setBalance] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pendingRequest, setPendingRequest] = useState(false)

  useEffect(() => {
    if (sessionLoading) return
    if (!vendorId) {
      setError('No vendor linked.')
      setLoading(false)
      return
    }
    Promise.all([vendorService.getVendorBalance(vendorId), hasPendingDeactivationRequest(vendorId)])
      .then(([bal, pending]) => {
        setBalance(bal)
        setPendingRequest(pending)
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [sessionLoading, vendorId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendorId) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await requestVendorDeactivation(vendorId, reason)
      if ('error' in result) {
        setError(result.error)
      } else {
        setSuccess(true)
        setPendingRequest(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  if (error && !vendorId) {
    return (
      <div className="page-container">
        <div className="data-card text-center py-12">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{error}</p>
          <Link href="/dashboard/vendor" className="mt-4 inline-block text-brand-600 hover:text-brand-700 text-sm font-medium">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="page-container max-w-lg space-y-6">
        <Link href="/dashboard/vendor" className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium">
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
        <div className="data-card text-center py-12">
          <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
          <h2 className="font-display text-xl font-bold text-slate-900 mb-2">Request submitted</h2>
          <p className="text-slate-600">
            Your deactivation request has been sent to the admin. You will be notified once it is reviewed.
          </p>
        </div>
      </div>
    )
  }

  const canRequest = balance !== null && balance === 0 && !pendingRequest

  return (
    <div className="page-container max-w-lg space-y-6">
      <Link href="/dashboard/vendor" className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium">
        <ArrowLeft className="w-4 h-4" />
        Back to dashboard
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Request deactivation</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Request to deactivate your vendor account. Admin will review after all obligations are cleared.
        </p>
      </div>

      <div className="data-card space-y-6">
        <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50">
          <span className="text-sm font-medium text-slate-700">Current balance</span>
          <span className={balance === 0 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
            {formatGHS(balance ?? 0)}
          </span>
        </div>

        {pendingRequest && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            You already have a pending deactivation request. Please wait for admin review.
          </div>
        )}

        {!canRequest && !pendingRequest && balance != null && balance !== 0 && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            Clear all financial obligations (balance must be GHS 0.00) before requesting deactivation.
          </div>
        )}

        {canRequest && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Reason (optional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="form-input resize-y"
                placeholder="Why are you requesting deactivation?"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-700 text-white font-semibold hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <PowerOff className="w-5 h-5" />}
              Submit deactivation request
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
