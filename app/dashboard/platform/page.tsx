'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, Crown, BadgeDollarSign, Scale, ClipboardList,
  HeartPulse, ArchiveRestore, ShieldAlert, Database, SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'

type PlatformStats = {
  vendor_count: number
  product_count: number
  sale_count: number
  payout_count: number
  audit_log_count: number
  delivery_count: number
}

type RevenueStats = {
  total_sales: number
  vendor_due: number
  developer_revenue: number
  distrogh_revenue: number
  total_qty: number
}

type ReconSummary = {
  status: string
  count: number
}

const NAV_CARDS = [
  { href: '/dashboard/platform/developer-accounts', label: 'Developer Accounts',  desc: 'Manage developer identities and access',     icon: Crown, color: 'bg-violet-50 border-violet-200 text-violet-700' },
  { href: '/dashboard/platform/revenue',            label: 'Platform Revenue',     desc: 'Developer fees and financial breakdowns',     icon: BadgeDollarSign, color: 'bg-brand-50 border-brand-200 text-brand-700' },
  { href: '/dashboard/platform/reconciliation',     label: 'Reconciliation',       desc: 'Verify all money movements',                  icon: Scale, color: 'bg-blue-50 border-blue-200 text-blue-700' },
  { href: '/dashboard/platform/audit-center',       label: 'Audit Center',         desc: 'Immutable platform-wide audit trail',         icon: ClipboardList, color: 'bg-amber-50 border-amber-200 text-amber-700' },
  { href: '/dashboard/platform/system-health',      label: 'System Health',        desc: 'Database, API and background job metrics',    icon: HeartPulse, color: 'bg-cyan-50 border-cyan-200 text-cyan-700' },
  { href: '/dashboard/platform/data-recovery',      label: 'Data Recovery',        desc: 'Restore soft-deleted records',                icon: ArchiveRestore, color: 'bg-orange-50 border-orange-200 text-orange-700' },
  { href: '/dashboard/platform/security',           label: 'Security Center',      desc: 'Login monitoring and threat detection',       icon: ShieldAlert, color: 'bg-red-50 border-red-200 text-red-700' },
  { href: '/dashboard/platform/database',           label: 'Database Monitoring',  desc: 'Table sizes, indexes and query performance',  icon: Database, color: 'bg-slate-50 border-slate-200 text-slate-700' },
  { href: '/dashboard/platform/configuration',      label: 'Configuration',        desc: 'System variables and feature flags',          icon: SlidersHorizontal, color: 'bg-gray-50 border-gray-200 text-gray-700' },
]

export default function PlatformDashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [revenue, setRevenue] = useState<RevenueStats | null>(null)
  const [recon, setRecon] = useState<ReconSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [healthRes, revRes, reconRes] = await Promise.all([
          fetch('/api/developer/system-health').then(r => r.json()),
          fetch('/api/developer/revenue?group_by=month&limit=1').then(r => r.json()),
          fetch('/api/developer/reconciliation?limit=20').then(r => r.json()),
        ])
        if (healthRes.success) setStats(healthRes.data.platform_stats)
        if (revRes.success) setRevenue(revRes.totals)
        if (reconRes.success) {
          const statusCounts: Record<string, number> = {}
          for (const r of reconRes.data) {
            statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1
          }
          setRecon(Object.entries(statusCounts).map(([status, count]) => ({ status, count })))
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [])

  const fmtCurrency = (n?: number | null) =>
    n != null ? `GHS ${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2 })}` : '—'

  const statusColor = (s: string) =>
    s === 'balanced' ? 'text-brand-600 bg-brand-50' :
    s === 'warning'  ? 'text-amber-600 bg-amber-50' :
    s === 'mismatch' ? 'text-red-600 bg-red-50' : 'text-slate-600 bg-slate-50'

  return (
    <div className="page-container">
      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5 text-violet-700" />
          </div>
        }
        title="Platform Management"
        description="Developer-level system oversight and financial controls"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vendors',  value: loading ? '…' : (stats?.vendor_count ?? '—').toString() },
          { label: 'Total Products', value: loading ? '…' : (stats?.product_count ?? '—').toString() },
          { label: 'Sales Records',  value: loading ? '…' : (stats?.sale_count ?? '—').toString() },
          { label: 'Audit Events',   value: loading ? '…' : (stats?.audit_log_count ?? '—').toString() },
        ].map(kpi => (
          <div key={kpi.label} className="kpi-card text-center !p-4">
            <p className="text-2xl font-bold text-slate-800">{kpi.value}</p>
            <p className="text-xs text-slate-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {revenue && (
        <div className="data-card">
          <h2 className="font-semibold text-slate-800 mb-4">All-Time Revenue Snapshot</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Sales',        value: fmtCurrency(revenue.total_sales),      color: 'text-slate-800' },
              { label: 'Vendor Due',         value: fmtCurrency(revenue.vendor_due),        color: 'text-blue-700' },
              { label: 'Developer Revenue',  value: fmtCurrency(revenue.developer_revenue), color: 'text-violet-700' },
              { label: 'DistroGH Revenue',   value: fmtCurrency(revenue.distrogh_revenue),  color: 'text-brand-700' },
            ].map(r => (
              <div key={r.label} className="text-center p-3 rounded-lg bg-slate-50">
                <p className={cn('text-lg font-bold', r.color)}>{r.value}</p>
                <p className="text-xs text-slate-500 mt-1">{r.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {recon.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recon.map(r => (
            <span key={r.status} className={cn('status-badge', statusColor(r.status))}>
              {r.status}: {r.count}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {NAV_CARDS.map(({ href, label, desc, icon: Icon, color }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'rounded-2xl border p-5 transition-all hover:shadow-card-hover',
              color
            )}
          >
            <Icon className="w-5 h-5 mb-3" />
            <p className="font-semibold text-slate-900">{label}</p>
            <p className="text-xs text-slate-500 mt-1">{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
