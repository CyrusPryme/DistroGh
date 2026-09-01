'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Plus, Phone, Edit2, Eye, Trash2, AlertCircle, Users, Clock, ShieldCheck, Archive, CreditCard, KeyRound,
} from 'lucide-react'
import { canAdminActivateVendor, getVendorVerificationStage } from '@/lib/vendor-verification'
import { VendorModal } from '@/components/vendors/VendorModal'
import { VendorAccessBadge } from '@/components/vendors/VendorAccessBadge'
import { vendorService } from '@/services/vendor.service'
import { softDeleteVendorCascade, createVendorAdmin, updateVendorAdmin } from '@/app/dashboard/vendors/actions'
import { formatGHS, formatDate, cn } from '@/lib/utils'
import { formatDisplayName } from '@/lib/format-display-name'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { IconAction } from '@/components/shared/IconAction'
import { DataTableShell, ListToolbar } from '@/components/shared/DataTableShell'
import { KPICard } from '@/components/dashboard/KPICard'
import { useToast } from '@/hooks/useToast'
import { usePageSize } from '@/hooks/usePageSize'
import { MOMO_NETWORK_COLORS } from '@/lib/utils'
import type { Vendor } from '@/types'
import type { VendorFormValues } from '@/lib/validations'

type AccessFilter = 'all' | 'self_service' | 'admin_managed'

type PendingConfirm =
  | { kind: 'delete'; id: string; name: string }
  | { kind: 'clear'; id: string; name: string }
  | { kind: 'clear_all'; count: number }

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
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editVendor, setEditVendor] = useState<Vendor | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast, showToast, dismissToast } = useToast(3500)
  const [vendorPage, setVendorPage] = useState(1)
  const [vendorPageSize, setVendorPageSize] = usePageSize('vendors', DEFAULT_PAGE_SIZE)
  const [clearing, setClearing] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  const load = async () => {
    try {
      const [vs, bs] = await Promise.all([
        vendorService.getAll(),
        vendorService.getBalances(),
      ])
      setVendors(vs)
      setBalances(new Map(bs.map((b) => [b.vendor_id, b.balance])))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load vendors')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const uploadFdaFile = async (
    vendorId: string,
    file: File,
    acquiredAt: string,
    expiryDate: string
  ): Promise<void> => {
    const form = new FormData()
    form.append('vendor_id', vendorId)
    form.append('file', file)
    form.append('fda_certificate_acquired_at', acquiredAt)
    form.append('facility_expiry_date', expiryDate)
    const res = await fetch('/api/vendor-documents/fda/upload', { method: 'POST', body: form })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error ?? 'FDA upload failed')
  }

  const handleSubmit = async (data: VendorFormValues, extras?: { fdaFile?: File }) => {
    setSubmitting(true)
    try {
      if (extras?.fdaFile) {
        const acquired = data.fda_certificate_acquired_at?.trim()
        const expiry = data.facility_expiry_date?.trim()
        if (!acquired || !expiry) {
          showToast('Date acquired and facility expiry are required when uploading an FDA certificate', 'error')
          return
        }
      }

      if (editVendor) {
        const result = await updateVendorAdmin(editVendor.id, data)
        if ('error' in result) {
          showToast(result.error, 'error')
          return
        }
        if (extras?.fdaFile) {
          await uploadFdaFile(
            editVendor.id,
            extras.fdaFile,
            data.fda_certificate_acquired_at!.trim(),
            data.facility_expiry_date!.trim()
          )
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
            await uploadFdaFile(
              vendor.id,
              extras.fdaFile,
              data.fda_certificate_acquired_at!.trim(),
              data.facility_expiry_date!.trim()
            )
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
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save vendor', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const runConfirm = useCallback(async () => {
    if (!pendingConfirm) return
    try {
      if (pendingConfirm.kind === 'delete') {
        await softDeleteVendorCascade(pendingConfirm.id)
        showToast('Vendor and related records soft deleted successfully')
      } else if (pendingConfirm.kind === 'clear') {
        setClearing(pendingConfirm.id)
        await vendorService.clearFromList(pendingConfirm.id)
        showToast(`"${pendingConfirm.name}" cleared from list`)
      } else {
        setClearing('all')
        const count = await vendorService.clearAllDeletedFromList()
        showToast(`${count} deleted vendor(s) cleared from list`)
      }
      setPendingConfirm(null)
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Action failed', 'error')
    } finally {
      setClearing(null)
    }
  }, [pendingConfirm, showToast])

  const filtered = vendors.filter((v) => {
    const q = search.toLowerCase()
    const matchesSearch =
      v.name.toLowerCase().includes(q) ||
      v.momo_number.includes(search) ||
      (v.contact_person_name ?? '').toLowerCase().includes(q)
    const matchesAccess =
      accessFilter === 'all' ||
      (accessFilter === 'admin_managed' && v.access_mode === 'admin_managed') ||
      (accessFilter === 'self_service' && v.access_mode !== 'admin_managed')
    return matchesSearch && matchesAccess
  })

  useEffect(() => {
    setVendorPage(1)
  }, [search, accessFilter])

  const paginatedVendors = useMemo(
    () => getPageSlice(filtered, vendorPage, vendorPageSize),
    [filtered, vendorPage, vendorPageSize]
  )

  const readyToActivate = useMemo(
    () => vendors.filter((v) => !v.deleted_at && canAdminActivateVendor(v)),
    [vendors]
  )

  const awaitingVendorDocs = useMemo(
    () => vendors.filter((v) => !v.deleted_at && getVendorVerificationStage(v) === 'awaiting_documents'),
    [vendors]
  )

  const activeVendors = useMemo(() => vendors.filter((v) => !v.deleted_at), [vendors])
  const deletedVendors = useMemo(() => vendors.filter((v) => v.deleted_at), [vendors])

  const portalCount = useMemo(
    () => activeVendors.filter((v) => v.access_mode !== 'admin_managed').length,
    [activeVendors]
  )
  const adminManagedCount = useMemo(
    () => activeVendors.filter((v) => v.access_mode === 'admin_managed').length,
    [activeVendors]
  )
  const outstandingPayable = useMemo(
    () => activeVendors.reduce((sum, v) => sum + (balances.get(v.id) ?? 0), 0),
    [activeVendors, balances]
  )

  const momoColors = MOMO_NETWORK_COLORS

  const filterTabs: { key: AccessFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: vendors.length },
    { key: 'self_service', label: 'Portal', count: vendors.filter((v) => v.access_mode !== 'admin_managed').length },
    { key: 'admin_managed', label: 'Admin-managed', count: vendors.filter((v) => v.access_mode === 'admin_managed').length },
  ]

  const confirmCopy = pendingConfirm
    ? pendingConfirm.kind === 'delete'
      ? {
          title: `Delete ${pendingConfirm.name}?`,
          description:
            'This will soft-delete the vendor and their products, sales, payouts, intakes, and returns. You can restore the vendor later (products must be restored separately).',
          confirmLabel: 'Delete vendor',
          destructive: true,
        }
      : pendingConfirm.kind === 'clear'
        ? {
            title: `Clear ${pendingConfirm.name} from this list?`,
            description: 'The vendor record stays in Audit Logs and can still be reviewed there.',
            confirmLabel: 'Clear from list',
            destructive: false,
          }
        : {
            title: `Clear ${pendingConfirm.count} deleted vendor(s)?`,
            description: 'They will be hidden from this list. History remains in Audit Logs.',
            confirmLabel: 'Clear all deleted',
            destructive: false,
          }
    : null

  return (
    <div className="page-container">
        <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={dismissToast} />

        <PageHeader
          title="Vendors"
          description="Manage supplier accounts, portal access, and outstanding payables"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
          <KPICard
            compact
            title="Active vendors"
            value={activeVendors.length}
            icon={Users}
            iconBg="bg-brand-50"
            iconColor="text-brand-600"
            subtitle={deletedVendors.length ? `${deletedVendors.length} deleted pending clear` : 'Currently on the roster'}
          />
          <KPICard
            compact
            title="Outstanding payables"
            value={outstandingPayable}
            icon={CreditCard}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            isCurrency
            subtitle="Sum of active vendor balances"
          />
          <KPICard
            compact
            title="Vendor access"
            value={`${portalCount} · ${adminManagedCount}`}
            icon={KeyRound}
            iconBg="bg-indigo-50"
            iconColor="text-indigo-600"
            subtitle="Portal · Admin-managed"
          />
        </div>

        {readyToActivate.length > 0 && (
          <div className="data-card border-2 border-brand-200 bg-brand-50/60 space-y-3">
            <div className="flex items-center gap-2 text-emerald-900 font-semibold">
              <ShieldCheck className="w-5 h-5 text-brand-600" />
              Final verification — {readyToActivate.length} vendor{readyToActivate.length === 1 ? '' : 's'} ready to activate
            </div>
            <p className="text-sm text-brand-800">
              These vendors submitted FDA documents and are waiting for you to activate their accounts.
            </p>
            <ul className="flex flex-col gap-2">
              {readyToActivate.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/dashboard/vendors/${v.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-white px-4 py-3 text-sm hover:border-emerald-400 transition-colors"
                  >
                    <span className="font-medium text-slate-900 truncate">{formatDisplayName(v.name)}</span>
                    <span className="inline-flex items-center gap-1 text-brand-700 font-medium shrink-0">
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

        {deletedVendors.length > 0 && (
          <div className="data-card border border-slate-200 bg-slate-50/80 py-3 px-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-800">
                {deletedVendors.length} deleted vendor{deletedVendors.length === 1 ? '' : 's'}
              </span>{' '}
              still shown here. Clear them when done reviewing — history is kept in{' '}
              <Link href="/dashboard/administration/audit-logs" className="text-brand-700 hover:underline font-medium">
                Audit Logs
              </Link>
              .
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0"
              disabled={clearing === 'all'}
              onClick={() => setPendingConfirm({ kind: 'clear_all', count: deletedVendors.length })}
            >
              <Archive className="w-4 h-4" />
              {clearing === 'all' ? 'Clearing…' : 'Clear all deleted'}
            </button>
          </div>
        )}

        <ListToolbar
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search vendors..."
              aria-label="Search vendors"
            />
          }
          filters={
            <SegmentedControl
              aria-label="Access filter"
              value={accessFilter}
              onChange={setAccessFilter}
              options={filterTabs.map((tab) => ({ value: tab.key, label: tab.label, count: tab.count }))}
            />
          }
          actions={
            <button
              type="button"
              onClick={() => {
                setEditVendor(null)
                setModalOpen(true)
              }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add Vendor
            </button>
          }
        />

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {error ? (
            <div className="flex items-center gap-3 p-6 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-slate-400">Loading vendors...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
                <Users className="h-7 w-7 text-slate-400" />
              </div>
              <p className="font-semibold text-slate-600">No vendors found</p>
              <p className="mt-1 text-sm text-slate-400">
                {search ? 'Try a different search term.' : 'Add your first vendor to get started.'}
              </p>
            </div>
          ) : (
          <DataTableShell
            pagination={
              <PaginationBar
                page={vendorPage}
                pageSize={vendorPageSize}
                totalItems={filtered.length}
                onPageChange={setVendorPage}
                onPageSizeChange={setVendorPageSize}
              />
            }
          >
            <table className="data-table min-w-[960px]">
                  <thead>
                    <tr>
                      <th className="min-w-[220px]">Vendor</th>
                      <th className="min-w-[120px]">Access</th>
                      <th className="min-w-[100px]">Network</th>
                      <th className="min-w-[140px]">MoMo Number</th>
                      <th className="min-w-[120px] text-right">Balance</th>
                      <th className="min-w-[110px]">Joined</th>
                      <th className="min-w-[140px]">Last Updated</th>
                      <th className="min-w-[128px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedVendors.map((vendor) => {
                      const colors = momoColors[vendor.momo_network] || {
                        bg: 'bg-gray-100',
                        text: 'text-gray-800',
                        border: 'border-gray-200',
                      }
                      const balance = balances.get(vendor.id) ?? 0
                      const isDeleted = Boolean(vendor.deleted_at)
                      const displayName = formatDisplayName(vendor.name)
                      return (
                        <tr key={vendor.id} className={cn(isDeleted && 'bg-slate-50/90')}>
                          <td className="min-w-[220px] max-w-[280px]">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                                {displayName.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <p
                                    className={cn(
                                      'min-w-0 truncate font-semibold text-slate-800',
                                      isDeleted && 'text-slate-500'
                                    )}
                                    title={displayName}
                                  >
                                    {displayName}
                                  </p>
                                  {isDeleted && (
                                    <span className="status-badge shrink-0 border-slate-300 bg-slate-200 text-[10px] uppercase tracking-wide text-slate-700">
                                      Deleted
                                    </span>
                                  )}
                                </div>
                                {vendor.contact_person_name ? (
                                  <p className="mt-0.5 truncate text-xs text-slate-500" title={vendor.contact_person_name}>
                                    {formatDisplayName(vendor.contact_person_name)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <VendorAccessBadge accessMode={vendor.access_mode} />
                          </td>
                          <td>
                            <span className={cn('status-badge whitespace-nowrap', colors.bg, colors.text, colors.border)}>
                              {vendor.momo_network}
                            </span>
                          </td>
                          <td className="min-w-[140px]">
                            <div className="flex items-center gap-1.5 font-mono text-sm tabular-nums text-slate-600 whitespace-nowrap">
                              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              {vendor.momo_number}
                            </div>
                          </td>
                          <td className="min-w-[120px] text-right">
                            <span
                              className={cn(
                                'font-semibold tabular-nums text-sm whitespace-nowrap',
                                balance > 0 ? 'text-amber-600' : 'text-brand-600'
                              )}
                            >
                              {formatGHS(balance)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-slate-500">{formatDate(vendor.created_at)}</td>
                          <td className="whitespace-nowrap">
                            <div className="flex items-center gap-1 text-sm text-slate-500">
                              <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              <span>{formatRelativeTime(vendor.updated_at)}</span>
                            </div>
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              <IconAction label="View details" href={`/dashboard/vendors/${vendor.id}`}>
                                <Eye className="h-4 w-4" />
                              </IconAction>
                              <IconAction
                                label={isDeleted ? 'Deleted vendors cannot be edited' : 'Edit vendor'}
                                disabled={isDeleted}
                                onClick={() => {
                                  setEditVendor(vendor)
                                  setModalOpen(true)
                                }}
                              >
                                <Edit2 className="h-4 w-4" />
                              </IconAction>
                              <IconAction
                                label={isDeleted ? 'Already deleted' : 'Delete vendor'}
                                disabled={isDeleted}
                                destructive
                                onClick={() => setPendingConfirm({ kind: 'delete', id: vendor.id, name: displayName })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </IconAction>
                              {isDeleted && (
                                <IconAction
                                  label="Clear from list (kept in Audit Logs)"
                                  disabled={clearing === vendor.id}
                                  onClick={() => setPendingConfirm({ kind: 'clear', id: vendor.id, name: displayName })}
                                >
                                  <Archive className="h-4 w-4" />
                                </IconAction>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
          </DataTableShell>
        )}
        </div>

        <VendorModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false)
            setEditVendor(null)
          }}
          onSubmit={handleSubmit}
          initialData={editVendor}
          isSubmitting={submitting}
        />

        <ConfirmDialog
          open={Boolean(pendingConfirm && confirmCopy)}
          title={confirmCopy?.title ?? ''}
          description={confirmCopy?.description ?? ''}
          confirmLabel={confirmCopy?.confirmLabel}
          destructive={confirmCopy?.destructive}
          busy={Boolean(clearing)}
          onConfirm={runConfirm}
          onClose={() => {
            if (!clearing) setPendingConfirm(null)
          }}
        />
    </div>
  )
}
