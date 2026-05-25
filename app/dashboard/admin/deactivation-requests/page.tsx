'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  getDeactivationRequests,
  approveDeactivationRequest,
  rejectDeactivationRequest,
} from '@/app/dashboard/vendors/actions'
import { ArrowLeft, PowerOff, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'

type Request = Awaited<ReturnType<typeof getDeactivationRequests>>[number]

export default function DeactivationRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [acting, setActing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [reqPage, setReqPage] = useState(1)

  const load = async () => {
    setLoading(true)
    try {
      const status = filter === 'all' ? undefined : filter
      const data = await getDeactivationRequests(status)
      setRequests(data)
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    setReqPage(1)
  }, [filter])

  const paginatedRequests = useMemo(
    () => getPageSlice(requests, reqPage, DEFAULT_PAGE_SIZE),
    [requests, reqPage]
  )

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleApprove = async (id: string) => {
    setActing(id)
    try {
      const result = await approveDeactivationRequest(id)
      if ('error' in result) {
        showToast(result.error, 'error')
      } else {
        showToast('Deactivation approved. Vendor soft-deleted.', 'success')
        load()
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setActing(null)
    }
  }

  const handleReject = async (id: string) => {
    setActing(id)
    try {
      const result = await rejectDeactivationRequest(id)
      if ('error' in result) {
        showToast(result.error, 'error')
      } else {
        showToast('Request rejected.', 'success')
        load()
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="page-container space-y-6">
      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium',
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/vendors"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Vendors
        </Link>
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Deactivation requests</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Vendor requests to deactivate their account. Approve only after financial obligations are cleared.
        </p>
      </div>

      <div className="flex gap-2">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium',
              filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="data-card p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto" />
          </div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <PowerOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No deactivation requests found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Vendor</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Contact</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Requested</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Reason</th>
                  <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                  {filter === 'pending' && <th className="text-right py-3 px-4 font-semibold text-slate-700">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedRequests.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-medium text-slate-900">{r.vendor?.name ?? '—'}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {r.vendor?.login_email ?? '—'}
                      {r.vendor?.contact_phone && (
                        <span className="block text-xs font-mono text-slate-500">{r.vendor.contact_phone}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{formatDate(r.requested_at)}</td>
                    <td className="py-3 px-4 text-slate-600 max-w-[200px] truncate" title={r.reason ?? undefined}>
                      {r.reason || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={cn(
                          'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                          r.status === 'pending' && 'bg-amber-100 text-amber-800',
                          r.status === 'approved' && 'bg-emerald-100 text-emerald-800',
                          r.status === 'rejected' && 'bg-red-100 text-red-800'
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    {filter === 'pending' && r.status === 'pending' && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(r.id)}
                            disabled={acting === r.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {acting === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(r.id)}
                            disabled={acting === r.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={reqPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={requests.length}
              onPageChange={setReqPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
