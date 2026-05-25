'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Search, Phone, Edit2, Eye, Trash2, AlertCircle, Users, Clock, UserX, Loader2, CheckCircle, ShieldCheck } from 'lucide-react'
import { canAdminActivateVendor, getVendorVerificationStage } from '@/lib/vendor-verification'
import { VendorModal } from '@/components/vendors/VendorModal'
import { vendorService } from '@/services/vendor.service'
import { getDeletedPendingAuthCleanup, markVendorAuthCleanupDone, softDeleteVendorCascade, createVendorAdmin, updateVendorAdmin } from '@/app/dashboard/vendors/actions'
import { formatGHS, formatDate, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { MOMO_NETWORK_COLORS } from '@/lib/utils'
import type { Vendor, VendorBalance } from '@/types'
import type { VendorFormValues } from '@/lib/validations'

// Helper function for relative time display
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  
  return formatDate(dateString)
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editVendor, setEditVendor] = useState<Vendor | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [deletedPending, setDeletedPending] = useState<{ id: string; name: string; login_email: string | null; deleted_at: string }[]>([])
  const [deletedLoading, setDeletedLoading] = useState(false)
  const [markingDone, setMarkingDone] = useState<string | null>(null)
  const [vendorPage, setVendorPage] = useState(1)

  const load = async () => {
    try {
      const [vs, bs] = await Promise.all([
        vendorService.getAll(),
        vendorService.getBalances(),
      ])
      setVendors(vs)
      setBalances(new Map(bs.map(b => [b.vendor_id, b.balance])))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadDeletedPending = async () => {
    setDeletedLoading(true)
    try {
      const data = await getDeletedPendingAuthCleanup()
      setDeletedPending(data)
    } catch {
      setDeletedPending([])
    } finally {
      setDeletedLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { loadDeletedPending() }, [])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const uploadFdaFile = async (vendorId: string, file: File): Promise<string> => {
    const form = new FormData()
    form.append('vendor_id', vendorId)
    form.append('file', file)
    const res = await fetch('/api/vendor-documents/fda/upload', { method: 'POST', body: form })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error ?? 'FDA upload failed')
    return String(json.data?.path ?? '')
  }

  const handleSubmit = async (data: VendorFormValues, extras?: { fdaFile?: File }) => {
    setSubmitting(true)
    try {
      if (editVendor) {
        let payload: Partial<VendorFormValues> & { fda_certificate_path?: string } = { ...data }
        if (extras?.fdaFile) {
          const path = await uploadFdaFile(editVendor.id, extras.fdaFile)
          payload = { ...data, fda_certificate_path: path } as any
        }
        const result = await updateVendorAdmin(editVendor.id, payload)
        if ('error' in result) {
          showToast(result.error, 'error')
          return
        }
        showToast('Vendor updated successfully')
      } else {
        const result = await createVendorAdmin(data)
        if ('error' in result) {
          showToast(result.error, 'error')
          return
        }
        const vendor = result.vendor
        if (extras?.fdaFile && vendor.id) {
          try {
            const path = await uploadFdaFile(vendor.id, extras.fdaFile)
            const updateResult = await updateVendorAdmin(vendor.id, { fda_certificate_path: path } as any)
            if ('error' in updateResult) showToast('Vendor created but saving FDA path failed', 'error')
          } catch (e: unknown) {
            showToast(
              'Vendor created but FDA upload failed: ' + (e instanceof Error ? e.message : 'Unknown error'),
              'error'
            )
          }
        }
        showToast('Vendor added successfully (admin-managed, no login)')
      }
      setModalOpen(false)
      setEditVendor(null)
      load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Soft delete vendor "${name}"? This will also soft-delete their products, sales, payouts, intakes, and returns. You can restore the vendor later (products must be restored separately).`)) return
    try {
      await softDeleteVendorCascade(id)
      showToast('Vendor and related records soft deleted successfully')
      load()
      loadDeletedPending()
    } catch (e: any) {
      showToast(e.message, 'error')
    }
  }

  const handleMarkAuthCleanupDone = async (id: string) => {
    setMarkingDone(id)
    try {
      await markVendorAuthCleanupDone(id)
      setDeletedPending((prev) => prev.filter((v) => v.id !== id))
      showToast('Marked as removed from Supabase')
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to mark', 'error')
    } finally {
      setMarkingDone(null)
    }
  }

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.momo_number.includes(search)
  )

  useEffect(() => {
    setVendorPage(1)
  }, [search])

  const paginatedVendors = useMemo(
    () => getPageSlice(filtered, vendorPage, DEFAULT_PAGE_SIZE),
    [filtered, vendorPage]
  )

  const readyToActivate = useMemo(
    () => vendors.filter((v) => !v.deleted_at && canAdminActivateVendor(v)),
    [vendors]
  )

  const awaitingVendorDocs = useMemo(
    () =>
      vendors.filter(
        (v) => !v.deleted_at && getVendorVerificationStage(v) === 'awaiting_documents'
      ),
    [vendors]
  )

  const momoColors = MOMO_NETWORK_COLORS

  return (
    <div className="page-container space-y-6">
      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium flex items-center gap-2 animate-slide-up',
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        )}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Vendors</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {vendors.length} registered vendors
            {filtered.length !== vendors.length && ` · ${filtered.length} match search`}
          </p>
        </div>
        <button
          onClick={() => { setEditVendor(null); setModalOpen(true) }}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Vendor
        </button>
      </div>

      {readyToActivate.length > 0 && (
        <div className="data-card border-2 border-emerald-200 bg-emerald-50/60 space-y-3">
          <div className="flex items-center gap-2 text-emerald-900 font-semibold">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Final verification — {readyToActivate.length} vendor{readyToActivate.length === 1 ? '' : 's'} ready to activate
          </div>
          <p className="text-sm text-emerald-800">
            These vendors submitted FDA documents and are waiting for you to activate their accounts.
          </p>
          <ul className="flex flex-col gap-2">
            {readyToActivate.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/dashboard/vendors/${v.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm hover:border-emerald-400 transition-colors"
                >
                  <span className="font-medium text-slate-900">{v.name}</span>
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                    Review &amp; activate
                    <Eye className="w-4 h-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {awaitingVendorDocs.length > 0 && (
        <div className="data-card border border-amber-200 bg-amber-50/50 py-3 px-4">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{awaitingVendorDocs.length}</span> approved vendor
            {awaitingVendorDocs.length === 1 ? ' is' : 's are'} still uploading FDA / facility documents.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="form-input pl-10"
          placeholder="Search vendors..."
        />
      </div>

      {/* Table */}
      <div className="data-card p-0 overflow-hidden">
        {error ? (
          <div className="flex items-center gap-3 p-6 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-slate-400">Loading vendors...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-slate-400" />
            </div>
            <p className="font-semibold text-slate-600">No vendors found</p>
            <p className="text-slate-400 text-sm mt-1">
              {search ? 'Try a different search term.' : 'Add your first vendor to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Network</th>
                  <th>MoMo Number</th>
                  <th>Balance</th>
                  <th>Joined</th>
                  <th>Last Updated</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVendors.map(vendor => {
                  const colors = momoColors[vendor.momo_network] || { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-200' }
                  const balance = balances.get(vendor.id) ?? 0
                  const isDeleted = Boolean(vendor.deleted_at)
                  return (
                    <tr key={vendor.id} className={cn(isDeleted && 'bg-slate-50/90')}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
                            {vendor.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className={cn('font-medium text-slate-800', isDeleted && 'text-slate-500')}>
                              {vendor.name}
                            </span>
                            {isDeleted && (
                              <span className="status-badge bg-slate-200 text-slate-700 border-slate-300 text-[10px] uppercase tracking-wide shrink-0">
                                Deleted
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={cn(
                          'status-badge',
                          colors.bg, colors.text, colors.border
                        )}>
                          {vendor.momo_network}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 font-mono text-sm text-slate-600">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {vendor.momo_number}
                        </div>
                      </td>
                      <td>
                        <span className={cn(
                          'font-bold text-sm',
                          balance > 0 ? 'text-amber-600' : 'text-emerald-600'
                        )}>
                          {formatGHS(balance)}
                        </span>
                      </td>
                      <td className="text-slate-500">{formatDate(vendor.created_at)}</td>
                      <td>
                        <div className="flex items-center gap-1 text-slate-500 text-sm">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatRelativeTime(vendor.updated_at)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1 justify-end">
                          <Link
                            href={`/dashboard/vendors/${vendor.id}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-emerald-600 transition-colors"
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          <button
                            type="button"
                            disabled={isDeleted}
                            onClick={() => { setEditVendor(vendor); setModalOpen(true) }}
                            className={cn(
                              'p-1.5 rounded-lg text-slate-400 transition-colors',
                              isDeleted
                                ? 'opacity-30 cursor-not-allowed'
                                : 'hover:bg-slate-100 hover:text-slate-700'
                            )}
                            title={isDeleted ? 'Deleted vendors cannot be edited' : 'Edit vendor'}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={isDeleted}
                            onClick={() => handleDelete(vendor.id, vendor.name)}
                            className={cn(
                              'p-1.5 rounded-lg text-slate-400 transition-colors',
                              isDeleted
                                ? 'opacity-30 cursor-not-allowed'
                                : 'hover:bg-red-50 hover:text-red-600'
                            )}
                            title={isDeleted ? 'Already deleted' : 'Soft delete vendor'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <PaginationBar
              page={vendorPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={filtered.length}
              onPageChange={setVendorPage}
            />
          </div>
        )}
      </div>

      {/* Deleted vendors – Supabase cleanup (bottom right) */}
      <div className="flex justify-end">
        <div className="w-full max-w-md data-card">
          <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2 mb-2">
            <UserX className="w-4 h-4 text-amber-600" />
            Deleted vendors – remove from Supabase
          </h3>
          <p className="text-slate-500 text-xs mb-4">
            Remove these users from Supabase Dashboard → Auth → Users, then mark as done.
          </p>
          {deletedLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : deletedPending.length === 0 ? (
            <p className="text-slate-400 text-sm py-4">No deleted vendors pending cleanup.</p>
          ) : (
            <ul className="space-y-2">
              {deletedPending.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800 truncate">{v.name}</p>
                    <code className="text-xs text-slate-500 truncate block">{v.login_email || '—'}</code>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleMarkAuthCleanupDone(v.id)}
                    disabled={markingDone === v.id}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded border border-emerald-200 text-emerald-700 text-xs font-medium hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {markingDone === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Done
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Modal */}
      <VendorModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditVendor(null) }}
        onSubmit={handleSubmit}
        initialData={editVendor}
        isSubmitting={submitting}
      />
    </div>
  )
}
