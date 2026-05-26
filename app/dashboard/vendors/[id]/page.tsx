'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfDay,
} from 'date-fns'
import {
  ArrowLeft,
  User,
  Phone,
  CreditCard,
  Package,
  TrendingUp,
  FileText,
  Printer,
  AlertCircle,
  Loader2,
  Calendar,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  MessageSquare,
  MinusCircle,
  Plus,
  PowerOff,
  CheckCircle,
  XCircle,
  Receipt,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { vendorService } from '@/services/vendor.service'
import { deductionService } from '@/services/deduction.service'
import {
  verifyVendor,
  suspendVendor,
  reactivateVendor,
  recordVendorServiceChargePaymentAdmin,
  resetVendorPassword,
  requestVerificationChanges,
  createDeductionAdmin,
  getDeactivationRequestForVendor,
  approveDeactivationRequest,
  rejectDeactivationRequest,
} from '@/app/dashboard/vendors/actions'
import {
  getServiceChargeLifecycle,
  getServiceChargePaymentStatus,
  SERVICE_CHARGE_LIFECYCLE_LABELS,
  SERVICE_CHARGE_GRACE_DAYS,
  SERVICE_CHARGE_REMINDER_DAYS,
  SERVICE_CHARGE_YEAR_OPTIONS,
  formatServiceChargeCoverage,
  previewServiceChargePayment,
  defaultServiceChargeExtendMode,
  type ServiceChargeExtendMode,
} from '@/lib/vendor-service-charge'
import { FdaCertificateViewer } from '@/components/vendors/FdaCertificateViewer'
import { VendorAccessBadge } from '@/components/vendors/VendorAccessBadge'
import { VendorPortalReport } from '@/components/vendors/VendorPortalReport'
import { isAdminManagedVendor } from '@/lib/vendor-access'
import { formatGHS, formatGHSChartAxis, formatDate, cn, MOMO_NETWORK_COLORS } from '@/lib/utils'
import { printReport } from '@/lib/print'
import { canAdminActivateVendor, getVendorStatus } from '@/lib/vendor-verification'
import { vendorHasFdaCertificate } from '@/lib/fda-certificate'
import type { Vendor } from '@/types'

type DatePresetKey = 'this_week' | 'this_month' | 'last_7' | 'last_30' | 'custom'
type TabKey = 'overview' | 'vendor-portal' | 'sales' | 'products' | 'deductions'

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
  { key: 'custom', label: 'Custom', getRange: () => ({ start: '', end: '' }) },
]

const CHART_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#d97706', '#dc2626']

interface VendorSaleRow {
  id: string
  product_id: string
  supermarket_id: string
  qty_sold: number
  unit_price: number
  total_sales: number
  commission_amount: number
  vendor_due: number
  week_start: string
  week_end: string
  product?: { id: string; name: string; vendor_id: string; commission_percent?: number }
  supermarket?: { id: string; name: string; location?: string }
}

function filterSalesByDateRange(sales: VendorSaleRow[], start: string, end: string): VendorSaleRow[] {
  if (!start || !end) return sales
  return sales.filter(
    (s) => s.week_start <= end && s.week_end >= start
  )
}

function aggregateVendorSalesByWeek(sales: VendorSaleRow[]): { week_start: string; total_sales: number; total_commission: number; total_vendor_due: number }[] {
  const map = new Map<string, { total_sales: number; total_commission: number; total_vendor_due: number }>()
  for (const s of sales) {
    const w = s.week_start ?? ''
    if (!w) continue
    const cur = map.get(w) ?? { total_sales: 0, total_commission: 0, total_vendor_due: 0 }
    cur.total_sales += Number(s.total_sales ?? 0)
    cur.total_commission += Number(s.commission_amount ?? 0)
    cur.total_vendor_due += Number(s.vendor_due ?? 0)
    map.set(w, cur)
  }
  return Array.from(map.entries())
    .map(([week_start, v]) => ({ week_start, ...v }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
}

function aggregateVendorSalesByProduct(sales: VendorSaleRow[]): { product_id: string; product_name: string; total_qty: number; total_sales: number }[] {
  const map = new Map<string, { product_name: string; total_qty: number; total_sales: number }>()
  for (const s of sales) {
    const pid = s.product_id
    const name = s.product?.name ?? 'Unknown'
    const cur = map.get(pid) ?? { product_name: name, total_qty: 0, total_sales: 0 }
    cur.total_qty += s.qty_sold ?? 0
    cur.total_sales += Number(s.total_sales ?? 0)
    map.set(pid, cur)
  }
  return Array.from(map.entries())
    .map(([product_id, v]) => ({ product_id, product_name: v.product_name, total_qty: v.total_qty, total_sales: v.total_sales }))
    .sort((a, b) => b.total_sales - a.total_sales)
}

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null)
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [products, setProducts] = useState<{ id: string; name: string; selling_price: number; vendor_price?: number; distrogh_markup?: number; created_at: string }[]>([])
  const [balance, setBalance] = useState<number>(0)
  const [payouts, setPayouts] = useState<any[]>([])
  const [allSales, setAllSales] = useState<VendorSaleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [datePreset, setDatePreset] = useState<DatePresetKey>('this_month')
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [actionError, setActionError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const [showRequestChanges, setShowRequestChanges] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [requestChangesSubmitting, setRequestChangesSubmitting] = useState(false)
  const [deductions, setDeductions] = useState<{ id: string; amount: number; reason: string; deduction_date: string }[]>([])
  const [showAddDeduction, setShowAddDeduction] = useState(false)
  const [deductionAmount, setDeductionAmount] = useState('')
  const [deductionReason, setDeductionReason] = useState('')
  const [deductionDate, setDeductionDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [addDeductionSubmitting, setAddDeductionSubmitting] = useState(false)
  const [deactivationRequest, setDeactivationRequest] = useState<{
    id: string
    vendor_id: string
    reason: string | null
    status: string
    requested_at: string
    admin_notes: string | null
  } | null>(null)
  const [deactivationActing, setDeactivationActing] = useState(false)
  const [recordingServiceCharge, setRecordingServiceCharge] = useState(false)
  const [serviceChargePaidAt, setServiceChargePaidAt] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [serviceChargeYears, setServiceChargeYears] = useState(1)
  const [serviceChargeMode, setServiceChargeMode] = useState<ServiceChargeExtendMode>('from_payment_date')

  useEffect(() => {
    let cancelled = false
    params.then((p) => {
      if (!cancelled) setId(p.id)
    })
    return () => { cancelled = true }
  }, [params])

  const getStartEnd = useCallback((): { start: string; end: string } => {
    if (datePreset === 'custom') return { start: customStart, end: customEnd }
    const preset = DATE_PRESETS.find((p) => p.key === datePreset)
    return preset ? preset.getRange() : { start: customStart, end: customEnd }
  }, [datePreset, customStart, customEnd])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [v, withProducts, bal, payoutList, salesList, deductionsList, deactReq] = await Promise.all([
        vendorService.getById(id),
        vendorService.getVendorWithProducts(id),
        vendorService.getVendorBalance(id),
        vendorService.getVendorPayoutHistory(id),
        vendorService.getVendorSales(id),
        deductionService.getByVendor(id),
        getDeactivationRequestForVendor(id),
      ])
      setDeactivationRequest(deactReq ?? null)
      if (!v) {
        setError('Vendor not found')
        setVendor(null)
        setProducts([])
        setBalance(0)
        setPayouts([])
        setAllSales([])
        setDeductions([])
      } else {
        setVendor(v)
        setBalance(bal)
        setPayouts(payoutList ?? [])
        setAllSales((salesList ?? []) as VendorSaleRow[])
        setDeductions((deductionsList ?? []).map((d: any) => ({ id: d.id, amount: d.amount, reason: d.reason, deduction_date: d.deduction_date })))
        const productsList = (withProducts as any)?.products ?? []
        setProducts(Array.isArray(productsList) ? productsList : [])
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load vendor')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const { start: rangeStart, end: rangeEnd } = getStartEnd()
  const filteredSales = rangeStart && rangeEnd ? filterSalesByDateRange(allSales, rangeStart, rangeEnd) : allSales
  const weeklyAgg = aggregateVendorSalesByWeek(filteredSales)
  const productAgg = aggregateVendorSalesByProduct(filteredSales)
  const rangeLabel = rangeStart && rangeEnd ? `${formatDate(rangeStart)} – ${formatDate(rangeEnd)}` : 'All time'
  const totalSalesInRange = filteredSales.reduce((s, r) => s + Number(r.total_sales ?? 0), 0)
  const totalMarkupInRange = filteredSales.reduce((s, r) => s + Number(r.commission_amount ?? 0), 0)
  const totalVendorDueInRange = filteredSales.reduce((s, r) => s + Number(r.vendor_due ?? 0), 0)

  const weeklyChartData = weeklyAgg.map((w) => ({
    week: formatDate(w.week_start).slice(0, 6),
    'Total Sales': Number(w.total_sales),
    Markup: Number(w.total_commission),
    'Vendor Due': Number(w.total_vendor_due),
  }))
  const productChartData = productAgg.slice(0, 8).map((p) => ({
    name: p.product_name.length > 14 ? p.product_name.slice(0, 14) + '…' : p.product_name,
    value: p.total_sales,
  }))

  const handlePrint = () => printReport('report-print-area')

  const handleVerify = async () => {
    if (!id) return
    setActionError(null)
    setVerifying(true)
    try {
      await verifyVendor(id)
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to verify')
    } finally {
      setVerifying(false)
    }
  }

  const handleSuspend = async () => {
    if (!id || !confirm('Suspend this vendor? They will not be able to log in until reactivated.')) return
    setActionError(null)
    setVerifying(true)
    try {
      await suspendVendor(id)
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to suspend')
    } finally {
      setVerifying(false)
    }
  }

  const status = vendor ? getVendorStatus(vendor) : 'pending_verification'
  const hasFdaAndFacility = vendor ? vendorHasFdaCertificate(vendor) : false
  const canVerify = vendor ? canAdminActivateVendor(vendor) : false
  const awaitingVendorDocs = status === 'pending_verification' && !hasFdaAndFacility
  const facilityExpired = !!(
    vendor?.facility_expiry_date &&
    new Date(vendor.facility_expiry_date) < new Date(new Date().toISOString().slice(0, 10))
  )
  const canSuspendForExpiry = status === 'active' && facilityExpired
  const serviceChargeLifecycle = vendor ? getServiceChargeLifecycle(vendor) : 'unpaid'
  const serviceChargePaid = vendor ? getServiceChargePaymentStatus(vendor) : 'unpaid'
  const canExtendCurrentSubscription = vendor
    ? defaultServiceChargeExtendMode(vendor) === 'extend_current'
    : false

  useEffect(() => {
    if (vendor) {
      setServiceChargeMode(defaultServiceChargeExtendMode(vendor))
    }
  }, [vendor?.id, vendor?.service_charge_expires_at])

  const serviceChargePreview = useMemo(() => {
    try {
      const paidAt = new Date(`${serviceChargePaidAt}T12:00:00`)
      if (Number.isNaN(paidAt.getTime())) return null
      return previewServiceChargePayment(
        paidAt,
        serviceChargeYears,
        vendor?.service_charge_expires_at,
        serviceChargeMode
      )
    } catch {
      return null
    }
  }, [serviceChargePaidAt, serviceChargeYears, serviceChargeMode, vendor?.service_charge_expires_at])

  const handleRecordServiceCharge = async () => {
    if (!id || !serviceChargePreview) return
    const confirmLines = [
      `Record service charge for ${vendor?.name ?? 'this vendor'}?`,
      '',
      ...serviceChargePreview.detailLines,
      '',
      `Summary: ${serviceChargePreview.summary}`,
    ]
    if (!confirm(confirmLines.join('\n'))) return

    setActionError(null)
    setRecordingServiceCharge(true)
    try {
      const result = await recordVendorServiceChargePaymentAdmin(id, {
        paid_at: `${serviceChargePaidAt}T12:00:00.000Z`,
        years: serviceChargeYears,
        mode: serviceChargeMode,
      })
      if ('error' in result) {
        setActionError(result.error)
        return
      }
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to record payment')
    } finally {
      setRecordingServiceCharge(false)
    }
  }

  const handleReactivate = async () => {
    if (!id || !confirm('Reactivate this vendor? They will be able to log in again.')) return
    setActionError(null)
    setVerifying(true)
    try {
      await reactivateVendor(id)
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to reactivate')
    } finally {
      setVerifying(false)
    }
  }

  async function handleRequestChanges() {
    if (!id || !feedbackMessage.trim()) {
      setActionError('Please enter a message for the applicant.')
      return
    }
    setActionError(null)
    setRequestChangesSubmitting(true)
    try {
      await requestVerificationChanges(id, feedbackMessage.trim())
      setShowRequestChanges(false)
      setFeedbackMessage('')
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to save feedback')
    } finally {
      setRequestChangesSubmitting(false)
    }
  }

  async function handleAddDeduction() {
    if (!id || !deductionAmount || !deductionReason.trim()) {
      setActionError('Amount and reason are required')
      return
    }
    const amt = parseFloat(deductionAmount)
    if (isNaN(amt) || amt <= 0) {
      setActionError('Amount must be greater than 0')
      return
    }
    setActionError(null)
    setAddDeductionSubmitting(true)
    try {
      const result = await createDeductionAdmin(id, {
        amount: amt,
        reason: deductionReason.trim(),
        deduction_date: deductionDate || undefined,
      })
      if ('error' in result) {
        setActionError(result.error)
        return
      }
      setShowAddDeduction(false)
      setDeductionAmount('')
      setDeductionReason('')
      setDeductionDate(format(new Date(), 'yyyy-MM-dd'))
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to add deduction')
    } finally {
      setAddDeductionSubmitting(false)
    }
  }

  async function handleResetPassword() {
    if (!id || !newPassword.trim() || newPassword !== confirmPassword) {
      setActionError('Passwords must match and be at least 8 characters')
      return
    }
    if (newPassword.trim().length < 8) {
      setActionError('Password must be at least 8 characters')
      return
    }
    setActionError(null)
    setResettingPassword(true)
    try {
      await resetVendorPassword(id, newPassword.trim())
      setNewPassword('')
      setConfirmPassword('')
      setShowResetPassword(false)
      await load()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to reset password')
    } finally {
      setResettingPassword(false)
    }
  }

  if (!id) return null

  return (
    <div className="page-container space-y-6">
      {/* Back link */}
      <div className="no-print">
        <Link
          href="/dashboard/vendors"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-emerald-700 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to vendors
        </Link>
      </div>

      {loading ? (
        <div className="data-card flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      ) : error || !vendor ? (
        <div className="data-card flex items-center gap-3 p-6 text-red-600">
          <AlertCircle className="w-5 h-5" />
          <span>{error ?? 'Vendor not found'}</span>
        </div>
      ) : (
        <>
          {canVerify && (
            <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-emerald-50 border-2 border-emerald-300">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-emerald-900">Final verification — ready to activate</p>
                  <p className="text-sm text-emerald-800 mt-1">
                    This vendor submitted their FDA certificate and facility expiry date. Review the documents below, then activate their account.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 shrink-0"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Activate vendor
              </button>
            </div>
          )}

          {awaitingVendorDocs && (
            <div className="no-print flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">Awaiting vendor documents</p>
                <p className="text-sm text-amber-800 mt-1">
                  Application was approved, but the vendor has not submitted their FDA certificate and facility expiry date yet. The activate button will appear here once they complete onboarding.
                </p>
              </div>
            </div>
          )}

          {/* Alert: pending deactivation request */}
          {deactivationRequest?.status === 'pending' && (
            <div className="no-print mb-6 flex items-start gap-3 p-4 rounded-xl bg-amber-50 border-2 border-amber-200">
              <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-900">Deactivation request pending</p>
                <p className="text-sm text-amber-800 mt-1">
                  This vendor has requested account deactivation on {formatDate(deactivationRequest.requested_at)}.
                  {deactivationRequest.reason && ` Reason: ${deactivationRequest.reason}`}
                </p>
                <p className="text-sm text-amber-700 mt-2">
                  Review the request below and approve only after all financial obligations are cleared.
                </p>
              </div>
            </div>
          )}

          {/* Vendor header card - always visible, print-friendly */}
          <div id="report-print-area" className="space-y-6">
            <div className="data-card border-b-2 border-slate-200 pb-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700 text-xl font-bold">
                    {vendor.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2 gap-y-1">
                      <h1 className="font-display text-2xl font-bold text-slate-900">{vendor.name}</h1>
                      {vendor.deleted_at && (
                        <span className="status-badge bg-slate-200 text-slate-700 border-slate-300 text-[10px] uppercase tracking-wide">
                          Deleted
                        </span>
                      )}
                      <VendorAccessBadge accessMode={vendor.access_mode} />
                    </div>
                    {vendor.contact_person_name && (
                      <p className="text-slate-600 text-sm mt-0.5">Contact: {vendor.contact_person_name}</p>
                    )}
                    <p className="text-slate-500 text-sm mt-0.5">Vendor profile</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-600">{formatGHS(balance)}</p>
                    <p className="text-xs text-slate-500">Current balance</p>
                  </div>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
                  <Phone className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">MoMo number</p>
                    <p className="font-mono font-medium text-slate-800">{vendor.momo_number}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
                  <CreditCard className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Network</p>
                    <span
                      className={cn(
                        'status-badge',
                        (MOMO_NETWORK_COLORS as any)[vendor.momo_network]?.bg ?? 'bg-gray-100',
                        (MOMO_NETWORK_COLORS as any)[vendor.momo_network]?.text ?? 'text-gray-800',
                        (MOMO_NETWORK_COLORS as any)[vendor.momo_network]?.border ?? 'border-gray-200'
                      )}
                    >
                      {vendor.momo_network}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
                  <Calendar className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Joined</p>
                    <p className="font-medium text-slate-800">{formatDate(vendor.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
                  <Package className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Products</p>
                    <p className="font-medium text-slate-800">{products.length} listed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Admin-managed vendor notice */}
            {isAdminManagedVendor(vendor) && (
              <div className="no-print flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
                <FileText className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900">Admin-managed vendor</p>
                  <p className="text-sm text-amber-800 mt-1">
                    No portal login. Use the <strong>Vendor report</strong> tab to print the same statement and analytics they would receive.
                  </p>
                  {vendor.report_delivery_notes && (
                    <p className="text-sm text-amber-700 mt-2">
                      Delivery notes: {vendor.report_delivery_notes}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Annual service charge */}
            <div className="no-print data-card space-y-4">
              <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-violet-600" />
                Annual service charge
              </h3>
              <p className="text-sm text-slate-500">
                Vendors receive a reminder {SERVICE_CHARGE_REMINDER_DAYS} days before expiry, then a{' '}
                {SERVICE_CHARGE_GRACE_DAYS}-day grace period before automatic suspension.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <span
                  className={cn(
                    'status-badge',
                    serviceChargePaid === 'paid' && serviceChargeLifecycle === 'active' && 'bg-emerald-100 text-emerald-800 border-emerald-200',
                    serviceChargeLifecycle === 'unpaid' && 'bg-slate-100 text-slate-700 border-slate-200',
                    serviceChargeLifecycle === 'expiring_soon' && 'bg-amber-100 text-amber-800 border-amber-200',
                    serviceChargeLifecycle === 'grace_period' && 'bg-orange-100 text-orange-800 border-orange-200',
                    (serviceChargeLifecycle === 'overdue' || (status === 'suspended' && vendor?.suspended_reason === 'service_charge')) &&
                      'bg-red-100 text-red-800 border-red-200'
                  )}
                >
                  {SERVICE_CHARGE_LIFECYCLE_LABELS[serviceChargeLifecycle]}
                </span>
                <span className="text-xs text-slate-500">
                  Payment: <strong className="text-slate-700">{serviceChargePaid === 'paid' ? 'Paid' : 'Unpaid'}</strong>
                </span>
              </div>
              <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500 uppercase tracking-wide">Last paid</dt>
                  <dd className="font-medium text-slate-800 mt-0.5">
                    {vendor?.service_charge_paid_at ? formatDate(String(vendor.service_charge_paid_at).slice(0, 10)) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 uppercase tracking-wide">Years (last payment)</dt>
                  <dd className="font-medium text-slate-800 mt-0.5">
                    {vendor?.service_charge_years_paid
                      ? `${vendor.service_charge_years_paid} year${vendor.service_charge_years_paid === 1 ? '' : 's'}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 uppercase tracking-wide">Covered until</dt>
                  <dd className="font-medium text-slate-800 mt-0.5">
                    {vendor?.service_charge_expires_at ? formatDate(vendor.service_charge_expires_at) : '—'}
                  </dd>
                </div>
              </dl>
              {vendor && formatServiceChargeCoverage(vendor) && (
                <p className="text-sm font-medium text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                  {formatServiceChargeCoverage(vendor)}
                </p>
              )}
              {(serviceChargeLifecycle === 'expiring_soon' || serviceChargeLifecycle === 'grace_period') && (
                <div
                  className={cn(
                    'p-3 rounded-lg text-sm border',
                    serviceChargeLifecycle === 'grace_period'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  )}
                >
                  {serviceChargeLifecycle === 'expiring_soon'
                    ? 'Renewal reminder window — vendor should see a banner in their dashboard.'
                    : `Grace period active — suspend automatically after ${SERVICE_CHARGE_GRACE_DAYS} days past expiry if unpaid.`}
                </div>
              )}
              <div className="pt-2 border-t border-slate-100 space-y-4">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Record payment</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Payment date</label>
                    <input
                      type="date"
                      value={serviceChargePaidAt}
                      onChange={(e) => setServiceChargePaidAt(e.target.value)}
                      className="form-input w-44"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Years paid</label>
                    <select
                      value={serviceChargeYears}
                      onChange={(e) => setServiceChargeYears(Number(e.target.value))}
                      className="form-input w-36"
                    >
                      {SERVICE_CHARGE_YEAR_OPTIONS.map((y) => (
                        <option key={y} value={y}>
                          {y} year{y === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {canExtendCurrentSubscription && (
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-medium text-slate-600">How to apply years</legend>
                    <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-700">
                      <input
                        type="radio"
                        name="serviceChargeMode"
                        checked={serviceChargeMode === 'extend_current'}
                        onChange={() => setServiceChargeMode('extend_current')}
                        className="mt-1"
                      />
                      <span>
                        <strong>Extend after current coverage</strong> (recommended if they still have time left)
                        {vendor?.service_charge_expires_at && (
                          <span className="block text-xs text-slate-500 mt-0.5">
                            Current end: {formatDate(vendor.service_charge_expires_at)}
                          </span>
                        )}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-700">
                      <input
                        type="radio"
                        name="serviceChargeMode"
                        checked={serviceChargeMode === 'from_payment_date'}
                        onChange={() => setServiceChargeMode('from_payment_date')}
                        className="mt-1"
                      />
                      <span>
                        <strong>From payment date only</strong> — replaces remaining time (use for new or lapsed accounts)
                      </span>
                    </label>
                  </fieldset>
                )}

                {serviceChargePreview ? (
                  <div className="rounded-xl border-2 border-violet-200 bg-violet-50/80 p-4 space-y-2">
                    <p className="text-xs font-semibold text-violet-900 uppercase tracking-wide">Preview before saving</p>
                    <p className="text-lg font-bold text-violet-950">
                      Valid until {formatDate(serviceChargePreview.expiresAt)}
                    </p>
                    <ul className="text-sm text-violet-900 space-y-1">
                      {serviceChargePreview.detailLines.map((line) => (
                        <li key={line}>• {line}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-red-600">Enter a valid payment date and years.</p>
                )}

                <button
                  type="button"
                  onClick={handleRecordServiceCharge}
                  disabled={recordingServiceCharge || !serviceChargePreview}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
                >
                  {recordingServiceCharge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                  Record {serviceChargeYears}-year payment
                </button>
              </div>
            </div>

            {/* Account & verification (admin): login credentials, FDA, facility, verify/suspend */}
            <div className="no-print data-card space-y-4">
              <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-600" />
                Account & verification
              </h3>
              {actionError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {actionError}
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <span className={cn(
                  'status-badge',
                  status === 'active' && 'bg-emerald-100 text-emerald-700 border-emerald-200',
                  status === 'pending_verification' && 'bg-amber-100 text-amber-700 border-amber-200',
                  status === 'suspended' && 'bg-red-100 text-red-700 border-red-200'
                )}>
                  {status === 'active' ? 'Active' : status === 'pending_verification' ? 'Pending verification' : 'Suspended'}
                </span>
                {canVerify && (
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={verifying}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    Activate vendor
                  </button>
                )}
                {status === 'suspended' && (
                  <button
                    type="button"
                    onClick={handleReactivate}
                    disabled={verifying}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    Reactivate
                  </button>
                )}
                {status === 'active' && (
                  <button
                    type="button"
                    onClick={handleSuspend}
                    disabled={verifying}
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60',
                      canSuspendForExpiry
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'border border-red-200 text-red-700 hover:bg-red-50'
                    )}
                    title={canSuspendForExpiry ? 'Facility expiry date has passed' : undefined}
                  >
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
                    {canSuspendForExpiry ? 'Suspend (certificate/facility expired)' : 'Suspend'}
                  </button>
                )}
              </div>
              {canSuspendForExpiry && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Facility expiry date ({vendor?.facility_expiry_date && formatDate(vendor.facility_expiry_date)}) has passed. Consider suspending the account until the vendor renews.</span>
                </div>
              )}
              {(vendor?.login_email != null || vendor?.initial_password != null) &&
                vendor.access_mode !== 'admin_managed' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {vendor?.login_email && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Login email</p>
                      <p className="font-mono text-sm text-slate-800">{vendor.login_email}</p>
                    </div>
                  )}
                  {vendor?.initial_password != null && vendor.initial_password !== '' && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Initial password</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-mono">
                          {showPassword ? vendor.initial_password : '••••••••••••'}
                        </code>
                        <button
                          type="button"
                          onClick={() => setShowPassword((p) => !p)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {vendor?.login_email && vendor.access_mode !== 'admin_managed' && (
                <div className="border-t border-slate-100 pt-4">
                  {!showResetPassword ? (
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(true)}
                      className="text-sm font-medium text-amber-600 hover:text-amber-700"
                    >
                      Reset login password (e.g. for test accounts)
                    </button>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 max-w-md">
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">New password</label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min 8 characters"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">Confirm</label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Same as above"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={resettingPassword || newPassword.length < 8 || newPassword !== confirmPassword}
                          onClick={handleResetPassword}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                        >
                          {resettingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          Set new password
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowResetPassword(false); setNewPassword(''); setConfirmPassword(''); setActionError(null); }}
                          className="text-sm text-slate-600 hover:text-slate-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 border-t border-slate-100 pt-4">
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500 mb-2">FDA certificate</p>
                  <FdaCertificateViewer
                    driveViewLink={vendor?.fda_drive_view_link}
                    certificatePath={vendor?.fda_certificate_path}
                    acquiredAt={vendor?.fda_certificate_acquired_at}
                    expiresAt={vendor?.facility_expiry_date}
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Facility expiry date</p>
                  {vendor?.facility_expiry_date ? (
                    <p className={cn('text-sm font-medium', facilityExpired ? 'text-red-700' : 'text-slate-800')}>
                      {formatDate(vendor.facility_expiry_date)}
                      {facilityExpired && <span className="ml-1.5 text-xs font-semibold">(Expired)</span>}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">Not submitted yet</p>
                  )}
                </div>
              </div>
              {canVerify && (
                <div className="border-t border-slate-100 pt-4">
                  {!showRequestChanges ? (
                    <button
                      type="button"
                      onClick={() => setShowRequestChanges(true)}
                      className="inline-flex items-center gap-2 text-sm font-medium text-amber-600 hover:text-amber-700"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Request changes (send message to applicant)
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-500">Message for applicant (they will see this when they log in)</label>
                      <textarea
                        value={feedbackMessage}
                        onChange={(e) => setFeedbackMessage(e.target.value)}
                        placeholder="e.g. FDA certificate is expired. Please upload a valid certificate."
                        rows={3}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={requestChangesSubmitting || !feedbackMessage.trim()}
                          onClick={handleRequestChanges}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                        >
                          {requestChangesSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                          Send message
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowRequestChanges(false); setFeedbackMessage(''); setActionError(null); }}
                          className="text-sm text-slate-600 hover:text-slate-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {vendor?.verified_at && (
                <p className="text-xs text-slate-500 border-t border-slate-100 pt-2">
                  Verified on {formatDate(vendor.verified_at)}
                </p>
              )}

              {/* Deactivation request */}
              {deactivationRequest && (
                <div className="border-t border-slate-200 pt-4 mt-4">
                  <h4 className="font-display font-semibold text-slate-900 flex items-center gap-2 mb-3">
                    <PowerOff className="w-5 h-5 text-slate-500" />
                    Deactivation request
                  </h4>
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={cn(
                      'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                      deactivationRequest.status === 'pending' && 'bg-amber-100 text-amber-800',
                      deactivationRequest.status === 'approved' && 'bg-emerald-100 text-emerald-800',
                      deactivationRequest.status === 'rejected' && 'bg-red-100 text-red-800'
                    )}>
                      {deactivationRequest.status}
                    </span>
                    <span className="text-sm text-slate-600">Requested {formatDate(deactivationRequest.requested_at)}</span>
                  </div>
                  {deactivationRequest.reason && (
                    <p className="text-sm text-slate-700 mt-2">{deactivationRequest.reason}</p>
                  )}
                  {deactivationRequest.status === 'pending' && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        disabled={deactivationActing || balance !== 0}
                        onClick={async () => {
                          setDeactivationActing(true)
                          setActionError(null)
                          try {
                            const result = await approveDeactivationRequest(deactivationRequest.id)
                            if ('error' in result) {
                              setActionError(result.error)
                            } else {
                              await load()
                            }
                          } finally {
                            setDeactivationActing(false)
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        title={balance !== 0 ? 'Clear balance before approving' : undefined}
                      >
                        {deactivationActing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Approve (soft-delete vendor)
                      </button>
                      <button
                        type="button"
                        disabled={deactivationActing}
                        onClick={async () => {
                          setDeactivationActing(true)
                          setActionError(null)
                          try {
                            const result = await rejectDeactivationRequest(deactivationRequest.id)
                            if ('error' in result) {
                              setActionError(result.error)
                            } else {
                              await load()
                            }
                          } finally {
                            setDeactivationActing(false)
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </button>
                      {balance !== 0 && (
                        <p className="text-xs text-amber-700 self-center">Balance must be {formatGHS(0)} to approve</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tabs - no-print for tab UI, content is in print area */}
            <div className="no-print flex flex-wrap gap-2 border-b border-slate-200 pb-4">
              {[
                { key: 'overview' as TabKey, label: 'Overview', icon: User },
                { key: 'vendor-portal' as TabKey, label: 'Vendor report', icon: FileText },
                { key: 'sales' as TabKey, label: 'Sales report', icon: TrendingUp },
                { key: 'products' as TabKey, label: 'Products report', icon: Package },
                { key: 'deductions' as TabKey, label: 'Deductions', icon: MinusCircle },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                    activeTab === key
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="data-card">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total sales (all time)</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">
                      {formatGHS(allSales.reduce((s, r) => s + Number(r.total_sales ?? 0), 0))}
                    </p>
                  </div>
                  <div className="data-card">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Current balance</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{formatGHS(balance)}</p>
                  </div>
                  <div className="data-card">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Products</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{products.length}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Pricing set per product</p>
                  </div>
                </div>
                {payouts.length > 0 && (
                  <div className="data-card">
                    <h3 className="font-display font-semibold text-slate-900 mb-4 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-emerald-600" />
                      Recent payouts
                    </h3>
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
                          {payouts.slice(0, 10).map((p: any) => (
                            <tr key={p.id}>
                              <td>{p.payout_date ? formatDate(p.payout_date) : '—'}</td>
                              <td className="text-slate-600 text-sm">
                                {p.week_start && p.week_end ? `${formatDate(p.week_start)} – ${formatDate(p.week_end)}` : '—'}
                              </td>
                              <td className="text-right font-mono">{formatGHS(Number(p.amount_due ?? 0))}</td>
                              <td className="text-right font-mono font-semibold">{formatGHS(Number(p.amount_paid ?? 0))}</td>
                              <td>
                                <span className={cn('status-badge', p.status === 'completed' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200')}>
                                  {p.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Vendor portal report — vendor-safe printable view */}
            {activeTab === 'vendor-portal' && id && (
              <VendorPortalReport
                vendorId={id}
                vendorName={vendor.name}
                contactPersonName={vendor.contact_person_name}
                accessMode={vendor.access_mode}
                previewLabel={
                  isAdminManagedVendor(vendor)
                    ? 'Printable report for this admin-managed vendor — hand over in person or via WhatsApp.'
                    : 'Preview what this vendor sees on their portal statement (agreed price only, no markup).'
                }
              />
            )}

            {/* Sales report tab */}
            {activeTab === 'sales' && (
              <div className="space-y-6">
                <div className="no-print data-card flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Period</label>
                    <div className="flex flex-wrap gap-2">
                      {DATE_PRESETS.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => setDatePreset(p.key)}
                          className={cn(
                            'px-3 py-2 rounded-xl text-sm font-medium transition-all',
                            datePreset === p.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                          onChange={(e) => setCustomStart(e.target.value)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                        <input
                          type="date"
                          value={customEnd}
                          onChange={(e) => setCustomEnd(e.target.value)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl"
                  >
                    <Printer className="w-4 h-4" />
                    Print report
                  </button>
                </div>
                <div className="data-card">
                  <h3 className="font-display font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    Sales report — {vendor.name}
                  </h3>
                  <p className="text-slate-500 text-sm mb-4">{rangeLabel}</p>
                  <div className="flex flex-wrap gap-4 mb-6">
                    <div>
                      <p className="text-xs text-slate-500">Total sales</p>
                      <p className="text-lg font-bold text-slate-800">{formatGHS(totalSalesInRange)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Markup</p>
                      <p className="text-lg font-bold text-violet-600">{formatGHS(totalMarkupInRange)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Vendor due</p>
                      <p className="text-lg font-bold text-emerald-600">{formatGHS(totalVendorDueInRange)}</p>
                    </div>
                  </div>
                  {weeklyAgg.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6">No sales in this period.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto mb-6">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Week</th>
                              <th className="text-right">Total sales</th>
                              <th className="text-right">Markup</th>
                              <th className="text-right">Vendor due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {weeklyAgg.map((w) => (
                              <tr key={w.week_start}>
                                <td className="font-medium">Week of {formatDate(w.week_start)}</td>
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
                            <Tooltip formatter={(v: number) => [formatGHS(v), '']} />
                            <Area type="monotone" dataKey="Total Sales" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} strokeWidth={2} />
                            <Area type="monotone" dataKey="Vendor Due" stroke="#16a34a" fill="#16a34a" fillOpacity={0.2} strokeWidth={2} />
                            <Line type="monotone" dataKey="Markup" stroke="#7c3aed" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Products report tab */}
            {activeTab === 'products' && (
              <div className="space-y-6">
                <div className="no-print data-card flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Period</label>
                    <div className="flex flex-wrap gap-2">
                      {DATE_PRESETS.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => setDatePreset(p.key)}
                          className={cn(
                            'px-3 py-2 rounded-xl text-sm font-medium transition-all',
                            datePreset === p.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                        <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                        <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl"
                  >
                    <Printer className="w-4 h-4" />
                    Print report
                  </button>
                </div>
                <div className="data-card">
                  <h3 className="font-display font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-600" />
                    Products report — {vendor.name}
                  </h3>
                  <p className="text-slate-500 text-sm mb-4">{rangeLabel} (sales performance)</p>
                  {productAgg.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6">No product sales in this period.</p>
                  ) : (
                    <div className="grid lg:grid-cols-2 gap-8">
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Product</th>
                              <th className="text-right">Qty sold</th>
                              <th className="text-right">Sales</th>
                            </tr>
                          </thead>
                          <tbody>
                            {productAgg.map((p, i) => (
                              <tr key={p.product_id}>
                                <td className="text-slate-400 font-mono text-xs">{i + 1}</td>
                                <td className="font-medium">{p.product_name}</td>
                                <td className="text-right font-mono">{p.total_qty}</td>
                                <td className="text-right font-mono font-semibold">{formatGHS(p.total_sales)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {productChartData.length > 0 && (
                        <div className="h-64 print-hide-chart">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={productChartData}
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                innerRadius={40}
                                dataKey="value"
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              >
                                {productChartData.map((_, i) => (
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
              </div>
            )}

            {/* Deductions tab */}
            {activeTab === 'deductions' && (
              <div className="space-y-6">
                <div className="data-card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-display font-semibold text-slate-900 flex items-center gap-2">
                      <MinusCircle className="w-5 h-5 text-amber-600" />
                      Vendor deductions (delivery, other costs)
                    </h3>
                    <button
                      onClick={() => { setShowAddDeduction(true); setActionError(null) }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                    >
                      <Plus className="w-4 h-4" />
                      Add deduction
                    </button>
                  </div>
                  {deductions.length === 0 ? (
                    <p className="text-slate-500 text-sm py-6">No deductions recorded yet. Add delivery charges or other costs here.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Reason</th>
                            <th className="text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deductions.map((d) => (
                            <tr key={d.id}>
                              <td className="text-slate-600">{formatDate(d.deduction_date)}</td>
                              <td>{d.reason}</td>
                              <td className="text-right font-mono font-semibold text-amber-700">-{formatGHS(d.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {deductions.length > 0 && (
                    <p className="text-slate-500 text-sm mt-4 pt-4 border-t border-slate-100">
                      Total deductions: <span className="font-semibold text-amber-700">{formatGHS(deductions.reduce((s, d) => s + d.amount, 0))}</span>
                    </p>
                  )}
                </div>

                {showAddDeduction && (
                  <div className="data-card border-2 border-emerald-200 bg-emerald-50/50">
                    <h4 className="font-display font-semibold text-slate-900 mb-4">Add deduction</h4>
                    {actionError && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm mb-4">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {actionError}
                      </div>
                    )}
                    <div className="grid gap-4 max-w-md">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Amount (GHS)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={deductionAmount}
                          onChange={(e) => setDeductionAmount(e.target.value)}
                          className="form-input"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
                        <input
                          type="text"
                          value={deductionReason}
                          onChange={(e) => setDeductionReason(e.target.value)}
                          className="form-input"
                          placeholder="e.g. Delivery cost, Packaging fee"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                        <input
                          type="date"
                          value={deductionDate}
                          onChange={(e) => setDeductionDate(e.target.value)}
                          className="form-input"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddDeduction}
                          disabled={addDeductionSubmitting}
                          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60 flex items-center gap-2"
                        >
                          {addDeductionSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          Add
                        </button>
                        <button
                          onClick={() => { setShowAddDeduction(false); setActionError(null) }}
                          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
