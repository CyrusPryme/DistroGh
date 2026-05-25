'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Building2, Mail, Phone, CheckCircle, XCircle, Clock, Loader2, Copy, KeyRound, ExternalLink, Trash2, ShieldCheck, AlertCircle } from 'lucide-react'
import { vendorService } from '@/services/vendor.service'
import { canAdminActivateVendor, getVendorVerificationStage } from '@/lib/vendor-verification'
import type { Vendor } from '@/types'
import { formatDate, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { vendorApplicationService } from '@/services/vendor-application.service'
import { approveVendorApplication, removeVendorApplication } from '@/app/dashboard/admin/applications/actions'
import type { VendorApplication } from '@/types/vendor-application'

type ApprovedCreds = { loginEmail: string; initialPassword: string; vendorId: string; storeName: string }

export default function VendorApplicationsPage() {
  const [applications, setApplications] = useState<VendorApplication[]>([])
  const [vendorById, setVendorById] = useState<Map<string, Vendor>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [approvedCreds, setApprovedCreds] = useState<ApprovedCreds | null>(null)
  const [appPage, setAppPage] = useState(1)

  const visibleApplications = useMemo(
    () => applications.filter((a) => a.status !== 'rejected'),
    [applications]
  )
  const paginatedApplications = useMemo(
    () => getPageSlice(visibleApplications, appPage, DEFAULT_PAGE_SIZE),
    [visibleApplications, appPage]
  )

  useEffect(() => {
    loadApplications()
  }, [])

  const loadApplications = async () => {
    try {
      const [data, vendors] = await Promise.all([
        vendorApplicationService.getAllApplications(),
        vendorService.getAll(),
      ])
      setApplications(data)
      setVendorById(new Map(vendors.filter((v) => !v.deleted_at).map((v) => [v.id, v])))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load applications')
    } finally {
      setLoading(false)
    }
  }

  const handleApproveApplication = async (application: VendorApplication) => {
    setProcessing(application.id)
    setError(null)
    setApprovedCreds(null)

    try {
      const result = await approveVendorApplication(application)
      setApprovedCreds({
        loginEmail: result.loginEmail,
        initialPassword: result.initialPassword,
        vendorId: result.vendorId,
        storeName: application.store_name,
      })
      await loadApplications()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to approve application'
      setError(`Failed to approve application: ${message}`)
    } finally {
      setProcessing(null)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      if (typeof window !== 'undefined') (window as any).__copied = true
    })
  }

  const handleRejectApplication = async (application: VendorApplication) => {
    if (!confirm(`Are you sure you want to reject ${application.store_name}? The application will be removed and they can apply again with the same email.`)) {
      return
    }

    setProcessing(application.id)
    setError(null)

    try {
      await vendorApplicationService.deleteApplication(application.id)
      setApplications((prev) => prev.filter((a) => a.id !== application.id))
    } catch (e: any) {
      console.error('Error rejecting application:', e)
      console.error('Error details:', {
        message: e.message,
        stack: e.stack,
        code: e.code
      })
      setError(`Failed to reject application: ${e.message}`)
    } finally {
      setProcessing(null)
    }
  }

  const handleRemoveApplication = async (application: VendorApplication) => {
    const verb = application.status === 'approved' ? 'remove this approved application' : 'remove this application'
    if (!confirm(`Are you sure you want to ${verb} from the list? This cannot be undone.`)) {
      return
    }

    setProcessing(application.id)
    setError(null)

    try {
      await removeVendorApplication(application.id)
      setApplications((prev) => prev.filter((a) => a.id !== application.id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove application')
    } finally {
      setProcessing(null)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-amber-500" />
      case 'approved':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'rejected':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <Clock className="w-4 h-4 text-gray-400" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-100 text-amber-700 border-amber-200'
      case 'approved':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-3">
      {/* Header - compact */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">Vendor Applications</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Step 1: approve application · Step 2: vendor uploads FDA · Step 3: activate on vendor profile
          </p>
        </div>
      </div>

      {/* Post-approval: show login credentials once - compact */}
      {approvedCreds && (
        <div className="data-card border-2 border-emerald-200 bg-emerald-50/80 py-3 px-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
            <CheckCircle className="w-4 h-4" />
            Account created for {approvedCreds.storeName}
          </div>
          <p className="text-xs text-slate-600">Share these credentials with the vendor.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex gap-1.5 items-center">
              <label className="text-xs font-medium text-slate-500 w-20 shrink-0">Login email</label>
              <code className="flex-1 min-w-0 rounded bg-white border border-slate-200 px-2 py-1 text-xs font-mono truncate">{approvedCreds.loginEmail}</code>
              <button type="button" onClick={() => copyToClipboard(approvedCreds.loginEmail)} className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50" title="Copy">
                <Copy className="w-3.5 h-3.5 text-slate-600" />
              </button>
            </div>
            <div className="flex gap-1.5 items-center">
              <label className="text-xs font-medium text-slate-500 w-20 shrink-0">Password</label>
              <code className="flex-1 min-w-0 rounded bg-white border border-slate-200 px-2 py-1 text-xs font-mono flex items-center gap-1">
                <KeyRound className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="truncate">{approvedCreds.initialPassword}</span>
              </code>
              <button type="button" onClick={() => copyToClipboard(approvedCreds.initialPassword)} className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50" title="Copy">
                <Copy className="w-3.5 h-3.5 text-slate-600" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Link href={`/dashboard/vendors/${approvedCreds.vendorId}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">
              <ExternalLink className="w-3.5 h-3.5" />
              View vendor
            </Link>
            <button type="button" onClick={() => setApprovedCreds(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Applications - compact table */}
      <div className="data-card p-0 overflow-hidden">
        {visibleApplications.length === 0 ? (
          <div className="text-center py-8">
            <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-600">No Applications</h3>
            <p className="text-slate-400 text-xs">No vendor applications have been submitted yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="text-left py-2 px-3 font-medium text-slate-600 w-10"></th>
                  <th className="text-left py-2 px-3 font-medium text-slate-600">Store</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-600">Contact</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-600 w-24">Status</th>
                  <th className="text-left py-2 px-3 font-medium text-slate-600 w-24">Applied</th>
                  <th className="text-right py-2 px-3 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedApplications.map((application) => (
                  <tr key={application.id} className="border-b border-slate-100 hover:bg-slate-50/50 last:border-0">
                    <td className="py-1.5 px-3">
                      <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
                        <Building2 className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                    </td>
                    <td className="py-1.5 px-3">
                      <span className="font-medium text-slate-800">{application.store_name}</span>
                      {application.description && (
                        <p className="text-xs text-slate-500 truncate max-w-[200px]" title={application.description}>
                          {application.description}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-slate-600">
                      <div className="space-y-0.5">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{application.contact_email}</span>
                        </span>
                        {application.contact_phone && (
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="font-mono">{application.contact_phone}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-3">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
                        getStatusColor(application.status)
                      )}>
                        {getStatusIcon(application.status)}
                        {application.status.charAt(0).toUpperCase() + application.status.slice(1)}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-slate-500 text-xs">
                      {formatDate(application.created_at)}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {application.status === 'pending' && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleApproveApplication(application)}
                            disabled={processing === application.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
                          >
                            {processing === application.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                            {processing === application.id ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleRejectApplication(application)}
                            disabled={processing === application.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
                          >
                            {processing === application.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                            Reject
                          </button>
                        </div>
                      )}
                      {(application.status === 'approved' || application.status === 'rejected') && (
                        <div className="inline-flex flex-col items-end gap-1.5">
                          {application.status === 'approved' && application.vendor_id && (() => {
                            const v = vendorById.get(application.vendor_id)
                            if (!v) {
                              return (
                                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                                  <CheckCircle className="w-3 h-3" />
                                  Account created
                                </span>
                              )
                            }
                            const stage = getVendorVerificationStage(v)
                            if (stage === 'active') {
                              return (
                                <span className="inline-flex items-center gap-1 text-xs text-green-700">
                                  <CheckCircle className="w-3 h-3" />
                                  Active
                                </span>
                              )
                            }
                            if (canAdminActivateVendor(v)) {
                              return (
                                <Link
                                  href={`/dashboard/vendors/${v.id}`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                                >
                                  <ShieldCheck className="w-3 h-3" />
                                  Activate account
                                </Link>
                              )
                            }
                            return (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                                <AlertCircle className="w-3 h-3" />
                                Awaiting vendor documents
                              </span>
                            )
                          })()}
                          <button
                            onClick={() => handleRemoveApplication(application)}
                            disabled={processing === application.id}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 text-slate-600 text-xs font-medium rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
                            title="Remove from list"
                          >
                            {processing === application.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={appPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={visibleApplications.length}
              onPageChange={setAppPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
