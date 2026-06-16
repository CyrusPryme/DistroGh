'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

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
  { href: '/dashboard/platform/developer-accounts', label: 'Developer Accounts',  desc: 'Manage developer identities and access',     icon: '👑', color: 'bg-violet-50 border-violet-200' },
  { href: '/dashboard/platform/revenue',            label: 'Platform Revenue',     desc: 'Developer fees and financial breakdowns',     icon: '💰', color: 'bg-emerald-50 border-emerald-200' },
  { href: '/dashboard/platform/reconciliation',     label: 'Reconciliation',       desc: 'Verify all money movements',                  icon: '⚖️', color: 'bg-blue-50 border-blue-200' },
  { href: '/dashboard/platform/audit-center',       label: 'Audit Center',         desc: 'Immutable platform-wide audit trail',         icon: '📋', color: 'bg-amber-50 border-amber-200' },
  { href: '/dashboard/platform/system-health',      label: 'System Health',        desc: 'Database, API and background job metrics',    icon: '🩺', color: 'bg-cyan-50 border-cyan-200' },
  { href: '/dashboard/platform/data-recovery',      label: 'Data Recovery',        desc: 'Restore soft-deleted records',                icon: '♻️', color: 'bg-orange-50 border-orange-200' },
  { href: '/dashboard/platform/security',           label: 'Security Center',      desc: 'Login monitoring and threat detection',       icon: '🔒', color: 'bg-red-50 border-red-200' },
  { href: '/dashboard/platform/database',           label: 'Database Monitoring',  desc: 'Table sizes, indexes and query performance',  icon: '🗄️', color: 'bg-slate-50 border-slate-200' },
  { href: '/dashboard/platform/configuration',      label: 'Configuration',        desc: 'System variables and feature flags',          icon: '⚙️', color: 'bg-gray-50 border-gray-200' },
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
    s === 'balanced' ? 'text-emerald-600 bg-emerald-50' :
    s === 'warning'  ? 'text-amber-600 bg-amber-50' :
    s === 'mismatch' ? 'text-red-600 bg-red-50' : 'text-slate-600 bg-slate-50'

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform Management</h1>
        <p className="text-slate-500 text-sm mt-1">Developer-level system oversight and financial controls</p>
      </div>

      {/* KPI Snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vendors',  value: loading ? '…' : (stats?.vendor_count ?? '—').toString() },
          { label: 'Total Products', value: loading ? '…' : (stats?.product_count ?? '—').toString() },
          { label: 'Sales Records',  value: loading ? '…' : (stats?.sale_count ?? '—').toString() },
          { label: 'Audit Events',   value: loading ? '…' : (stats?.audit_log_count ?? '—').toString() },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-slate-800">{kpi.value}</p>
            <p className="text-xs text-slate-500 mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Revenue Snapshot */}
      {revenue && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-4">All-Time Revenue Snapshot</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Sales',        value: fmtCurrency(revenue.total_sales),      color: 'text-slate-800' },
              { label: 'Vendor Due',         value: fmtCurrency(revenue.vendor_due),        color: 'text-blue-700' },
              { label: 'Developer Revenue',  value: fmtCurrency(revenue.developer_revenue), color: 'text-violet-700' },
              { label: 'DistroGH Revenue',   value: fmtCurrency(revenue.distrogh_revenue),  color: 'text-emerald-700' },
            ].map(r => (
              <div key={r.label} className="text-center p-3 rounded-lg bg-slate-50">
                <p className={cn('text-lg font-bold', r.color)}>{r.value}</p>
                <p className="text-xs text-slate-500 mt-1">{r.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reconciliation Status */}
      {recon.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Recent Reconciliation Status</h2>
            <Link href="/dashboard/platform/reconciliation" className="text-sm text-violet-600 hover:underline">View all →</Link>
          </div>
          <div className="flex gap-3 flex-wrap">
            {recon.map(r => (
              <span key={r.status} className={cn('px-3 py-1 rounded-full text-sm font-medium', statusColor(r.status))}>
                {r.status}: {r.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Module Grid */}
      <div>
        <h2 className="font-semibold text-slate-800 mb-4">Platform Modules</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {NAV_CARDS.map(card => (
            <Link
              key={card.href}
              href={card.href}
              className={cn(
                'rounded-xl border p-5 flex items-start gap-4 hover:shadow-md transition-shadow group',
                card.color
              )}
            >
              <span className="text-3xl select-none">{card.icon}</span>
              <div>
                <p className="font-semibold text-slate-800 group-hover:text-violet-700 transition-colors">{card.label}</p>
                <p className="text-sm text-slate-500 mt-0.5">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
