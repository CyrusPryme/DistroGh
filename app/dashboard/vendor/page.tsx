'use client'

import { useEffect, useState } from 'react'
import { useSession } from '@/hooks/useSession'
import Link from 'next/link'
import {
  BarChart3, ShoppingCart, Users, CreditCard, Package,
  ArrowRight, AlertCircle, Upload, FileText, Calendar, Loader2, ShieldCheck
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend
} from 'recharts'
import { KPICard } from '@/components/dashboard/KPICard'
import { salesService } from '@/services/sales.service'
import { vendorService } from '@/services/vendor.service'
import { returnsService } from '@/services/returns.service'
import { vendorHasFdaCertificate } from '@/lib/fda-certificate'
import {
  formatGHS, formatGHSChartAxis, formatDate, formatSalesPeriod, formatNumber, cn
} from '@/lib/utils'
import type { DashboardKPIs, VendorBalance, WeeklyRevenue, ProductPerformance, Vendor } from '@/types'

export default function VendorDashboardPage() {
  const { vendorId, loading: sessionLoading } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [recentSales, setRecentSales] = useState<any[]>([])
  const [weeklyRevenue, setWeeklyRevenue] = useState<WeeklyRevenue[]>([])
  const [topProducts, setTopProducts] = useState<ProductPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [totalQuantitySold, setTotalQuantitySold] = useState(0)
  const [onboardingSubmitting, setOnboardingSubmitting] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [onboardingSuccess, setOnboardingSuccess] = useState(false)
  const [fdaFile, setFdaFile] = useState<File | null>(null)
  const [fdaAcquired, setFdaAcquired] = useState('')
  const [facilityExpiry, setFacilityExpiry] = useState('')

  useEffect(() => {
    if (sessionLoading) return
    if (!vendorId) {
      setLoading(false)
      return
    }
    vendorService.getById(vendorId).then((v) => {
      setVendor(v ?? null)
      const s = (v as { status?: string })?.status
      if (s === 'suspended' || s === 'pending_verification') setLoading(false)
    })
  }, [sessionLoading, vendorId])

  useEffect(() => {
    if (sessionLoading || !vendorId) return
    
    async function load() {
      const id = vendorId ?? undefined
      if (!id) return
      try {
        const [vendorSales, vendorWeeklyRevenue, vendorTopProducts, returns] = await Promise.all([
          salesService.getAll({ vendor_id: id }),
          salesService.getWeeklyRevenue(8, id),
          salesService.getTopProducts(5, id),
          returnsService.getAll({ vendor_id: id }),
        ])
        
        let returnVendorDue = 0
        for (const r of returns) {
          const vendorPrice = Number((r.product as { vendor_price?: number })?.vendor_price ?? 0)
          returnVendorDue += Number(r.quantity_returned) * vendorPrice
        }

        const salesVendorDue = vendorSales.reduce((sum, s) => sum + Number(s.vendor_due), 0)
        const netVendorDue = Math.max(0, salesVendorDue - returnVendorDue)
        const totalQty = vendorSales.reduce((sum, s) => sum + Number(s.qty_sold ?? 0), 0)
        const vendorKPIs: DashboardKPIs = {
          totalSales: netVendorDue,
          totalCommission: 0,
          totalVendorDue: netVendorDue,
          vendorCount: 1,
          productCount: vendorTopProducts.length,
          pendingPayouts: 0,
        }
        
        setKpis(vendorKPIs)
        setTotalQuantitySold(totalQty)
        setRecentSales(vendorSales.slice(0, 8))
        setWeeklyRevenue([...vendorWeeklyRevenue].reverse())
        setTopProducts(vendorTopProducts)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionLoading, vendorId])

  const chartData = weeklyRevenue.map(w => ({
    week: w.week_start ? formatSalesPeriod(w.week_start, w.week_end) : '',
    'Your earnings': Number(w.total_vendor_due ?? w.total_sales ?? 0),
  }))

  const productChartData = topProducts.map(p => ({
    name: p.product_name.length > 18 ? p.product_name.slice(0, 18) + '…' : p.product_name,
    Sales: p.total_sales,
    Qty: p.total_qty,
  }))

  const isLoading = sessionLoading || loading || (vendorId != null && vendor == null)
  if (isLoading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium">Loading dashboard...</span>
        </div>
      </div>
    )
  }

  if (!vendorId) {
    return (
      <div className="page-container">
        <div className="data-card text-center py-12">
          <Package className="w-14 h-14 text-slate-300 mx-auto mb-4" />
          <h2 className="font-display text-xl font-semibold text-slate-700">No vendor assigned</h2>
          <p className="text-slate-500 text-sm mt-2">Your account is not linked to a vendor. Contact your administrator.</p>
        </div>
      </div>
    )
  }

  const status = (vendor?.status ?? 'pending_verification') as 'pending_verification' | 'active' | 'suspended'
  const hasAdminFeedback = !!(vendor as any)?.verification_feedback?.trim()
  const hasFdaOnFile = vendor ? vendorHasFdaCertificate(vendor) : false
  const needsOnboarding = status === 'pending_verification' && !hasFdaOnFile
  const needsResubmission = status === 'pending_verification' && hasFdaOnFile && hasAdminFeedback
  const pendingVerification = status === 'pending_verification' && hasFdaOnFile && !hasAdminFeedback

  if (status === 'suspended') {
    const serviceChargeSuspended =
      (vendor as { suspended_reason?: string })?.suspended_reason === 'service_charge'
    return (
      <div className="page-container max-w-xl">
        <div className="data-card border-2 border-red-200 bg-red-50/80 space-y-6">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-red-200 text-red-800">
              Status: Suspended
            </span>
          </div>
          <div className="text-center">
            <ShieldCheck className="w-14 h-14 text-red-400 mx-auto mb-4" />
            <h2 className="font-display text-xl font-semibold text-red-800">Account suspended</h2>
            <p className="text-slate-600 text-sm mt-2">
              {serviceChargeSuspended
                ? 'Your annual DistroGH service charge was not renewed after the grace period. Your account is suspended until payment is recorded by an administrator.'
                : 'Your vendor account has been suspended by the administrator.'}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white/80 border border-red-200">
            <p className="font-semibold text-slate-800 text-sm mb-1">Next step</p>
            <p className="text-slate-600 text-sm">
              {serviceChargeSuspended
                ? 'Contact your administrator to pay the annual service charge and restore access.'
                : 'Contact your administrator to resolve this. They can reactivate your account.'}
            </p>
            <Link
              href="/dashboard/support"
              className="inline-block mt-3 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Contact support
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (needsOnboarding || needsResubmission) {
    const handleOnboardingSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!vendorId || !fdaFile || !fdaAcquired.trim() || !facilityExpiry.trim()) {
        setOnboardingError('Please upload your FDA certificate and enter both dates.')
        return
      }
      setOnboardingError(null)
      setOnboardingSubmitting(true)
      try {
        const form = new FormData()
        form.append('vendor_id', vendorId)
        form.append('file', fdaFile)
        form.append('fda_certificate_acquired_at', fdaAcquired.trim())
        form.append('facility_expiry_date', facilityExpiry.trim())
        const upRes = await fetch('/api/vendor-documents/fda/upload', { method: 'POST', body: form })
        const upJson = await upRes.json().catch(() => null)
        if (!upRes.ok || !upJson?.success) throw new Error(upJson?.error ?? 'Upload failed')
        setOnboardingSuccess(true)
        const v = await vendorService.getById(vendorId)
        setVendor(v ?? null)
      } catch (e: unknown) {
        setOnboardingError(e instanceof Error ? e.message : 'Failed to submit')
      } finally {
        setOnboardingSubmitting(false)
      }
    }
    return (
      <div className="page-container max-w-xl">
        <div className="data-card border-2 border-amber-200 bg-amber-50/50 space-y-6">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-200 text-amber-800">
              Status: {needsResubmission ? 'Changes requested' : 'Pending'}
            </span>
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              {needsResubmission ? 'Changes requested' : 'Complete your registration'}
            </h1>
            <p className="text-slate-600 text-sm mt-1">
              {needsResubmission
                ? 'The administrator has requested changes to your FDA certificate or facility details. Please correct and resubmit below.'
                : 'To activate your vendor account, provide your FDA (Food and Drugs Authority, Ghana) certificate with the date acquired and facility expiry date. An administrator will verify and activate your account.'}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white/80 border border-amber-200">
            <p className="font-semibold text-slate-800 text-sm mb-1">Next step</p>
            <p className="text-slate-600 text-sm">
              {needsResubmission ? 'Resubmit your FDA certificate and dates per the administrator feedback below.' : 'Upload FDA certificate and enter the date acquired and facility expiry date.'}
            </p>
          </div>
          {hasAdminFeedback && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
              <p className="font-semibold mb-1">Message from administrator</p>
              <p className="whitespace-pre-wrap">{(vendor as any).verification_feedback}</p>
            </div>
          )}
          {onboardingSuccess ? (
            <div className="p-4 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-800 text-sm">
              {needsResubmission ? 'Documents resubmitted.' : 'Details submitted.'} Your account is pending admin verification. You will get full access once verified.
            </div>
          ) : (
            <form onSubmit={handleOnboardingSubmit} className="space-y-5">
              {onboardingError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {onboardingError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  FDA certificate (PDF or image) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/webp"
                    onChange={(e) => setFdaFile(e.target.files?.[0] ?? null)}
                    className="form-input pl-10"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Date acquired <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    value={fdaAcquired}
                    onChange={(e) => setFdaAcquired(e.target.value)}
                    className="form-input pl-10"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Facility expiry date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    value={facilityExpiry}
                    onChange={(e) => setFacilityExpiry(e.target.value)}
                    className="form-input pl-10"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={onboardingSubmitting}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {onboardingSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                {needsResubmission ? 'Resubmit for verification' : 'Submit for verification'}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  if (pendingVerification) {
    return (
      <div className="page-container max-w-xl">
        <div className="data-card border-2 border-amber-200 bg-amber-50/50 space-y-6">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-200 text-amber-800">
              Status: Pending verification
            </span>
          </div>
          <div className="text-center">
            <ShieldCheck className="w-14 h-14 text-amber-500 mx-auto mb-4" />
            <h2 className="font-display text-xl font-semibold text-slate-800">Pending verification</h2>
            <p className="text-slate-600 text-sm mt-2">Your FDA certificate and facility expiry date have been submitted.</p>
          </div>
          <div className="p-4 rounded-xl bg-white/80 border border-amber-200">
            <p className="font-semibold text-slate-800 text-sm mb-1">Next step</p>
            <p className="text-slate-600 text-sm">An administrator will review and verify your documents. You will get full access once approved. Contact admin if you have questions.</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="flex items-center gap-3 p-6 bg-red-50 rounded-xl border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <div>
            <p className="font-semibold text-red-700">Failed to load dashboard</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-slate-900">Vendor Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" />
              Status: Approved
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-0.5">
            {vendor?.name ? `${vendor.name} · Manage your products and sales` : 'Manage your products and sales'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/vendor/profile"
            className="flex items-center gap-2 border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            Profile
          </Link>
        </div>
      </div>

      {/* KPI Cards - Vendor Specific (only vendor's own earnings, not admin commission) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Earnings (agreed price)"
          value={kpis?.totalSales ?? 0}
          icon={BarChart3}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          isCurrency
        />
        <Link href="/dashboard/vendor/payouts" className="block group hover:opacity-90 transition-opacity">
          <KPICard
            title="Amount Due to You"
            value={kpis?.totalVendorDue ?? 0}
            icon={CreditCard}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            isCurrency
            subtitle="View payout history"
          />
        </Link>
        <KPICard
          title="Products Listed"
          value={kpis?.productCount ?? 0}
          icon={Package}
          iconBg="bg-cyan-50"
          iconColor="text-cyan-600"
        />
        <KPICard
          title="Total Quantity Sold"
          value={totalQuantitySold}
          icon={Users}
          iconBg="bg-slate-50"
          iconColor="text-slate-600"
          isCurrency={false}
        />
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Weekly Revenue Chart */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-display font-semibold text-slate-900">Weekly Earnings</h3>
              <p className="text-xs text-slate-400 mt-0.5">At your agreed price · last 8 weeks</p>
            </div>
            <Link href="/dashboard/reports" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View report <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {chartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
              No sales data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v: number) => [formatGHS(v), '']}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Your earnings" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Products Chart */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-display font-semibold text-slate-900">Your Products</h3>
              <p className="text-xs text-slate-400 mt-0.5">By earnings at agreed price</p>
            </div>
            <Link href="/dashboard/products" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Manage products <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {productChartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-slate-400 text-sm">
              No sales data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={productChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={formatGHSChartAxis} />
                <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v: number) => [formatGHS(v), 'Sales']}
                />
                <Bar dataKey="Sales" fill="#16a34a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent Sales + Performance */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Sales */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900">Your Recent Sales</h3>
            <Link href="/dashboard/sales" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-slate-400 py-8 text-sm">
                      No sales data. Import your first Excel file.
                    </td>
                  </tr>
                ) : (
                  recentSales.map(sale => (
                    <tr key={sale.id}>
                      <td>
                        <div className="font-medium text-slate-800 text-sm">
                          {(sale.product as any)?.name ?? '—'}
                        </div>
                      </td>
                      <td className="text-slate-600">{formatNumber(sale.qty_sold)}</td>
                      <td className="text-right font-semibold text-slate-800">
                        {formatGHS(Number(sale.vendor_due))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Performance Summary */}
        <div className="data-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-slate-900">Your Performance</h3>
            <Link href="/dashboard/reports" className="text-xs text-brand-600 font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View reports <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">Earnings (agreed price)</p>
                <p className="text-2xl font-bold text-blue-600">{formatGHS(kpis?.totalSales ?? 0)}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">Amount Due to You</p>
                <p className="text-2xl font-bold text-emerald-600">{formatGHS(kpis?.totalVendorDue ?? 0)}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 p-4 bg-cyan-50 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-cyan-100 flex items-center justify-center">
                <Package className="w-6 h-6 text-cyan-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">Products Listed</p>
                <p className="text-2xl font-bold text-cyan-600">{kpis?.productCount ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
