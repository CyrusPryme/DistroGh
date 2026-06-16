'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PageToast } from '@/components/shared/PageToast'

type ReconRun = {
  id: string
  period_type: string
  period_start: string
  period_end: string
  status: string
  total_sales_revenue: number
  total_vendor_due: number
  total_developer_revenue: number
  total_distrogh_revenue: number
  total_returns_value: number
  total_deductions: number
  total_payouts_completed: number
  total_transport_charges: number
  expected_vendor_payable: number
  actual_vendor_balance_sum: number
  variance: number
  variance_pct: number
  notes?: string
  created_by_email?: string
  created_at: string
}

type Toast = { type: 'success' | 'error'; message: string } | null

const STATUS_COLOR: Record<string, string> = {
  balanced: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning:  'bg-amber-100 text-amber-700 border-amber-200',
  mismatch: 'bg-red-100 text-red-700 border-red-200',
  pending:  'bg-slate-100 text-slate-600 border-slate-200',
}

export default function ReconciliationPage() {
  const [runs, setRuns] = useState<ReconRun[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast>(null)
  const [form, setForm] = useState({ period_type: 'monthly', period_start: '', period_end: '', notes: '' })

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message }); setTimeout(() => setToast(null), 4000)
  }

  const loadRuns = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/developer/reconciliation?limit=50')
      const data = await res.json()
      if (data.success) setRuns(data.data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { loadRuns() }, [])

  const handleRun = async () => {
    if (!form.period_start || !form.period_end) { showToast('error', 'Set both start and end dates.'); return }
    setRunning(true)
    try {
      const res = await fetch('/api/developer/reconciliation/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed'); return }
      showToast('success', `Reconciliation complete: ${data.data.status}.`)
      setForm(f => ({ ...f, notes: '' }))
      loadRuns()
    } catch { showToast('error', 'Network error') } finally { setRunning(false) }
  }

  const fmt = (n?: number | null) => n != null ? `GHS ${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2 })}` : '—'
  const fmtDate = (d: string) => new Date(d).toLocaleDateString()

  // Quick shortcut: set period to current month
  const setCurrentMonth = () => {
    const now = new Date()
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0')
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    setForm(f => ({ ...f, period_start: `${y}-${m}-01`, period_end: `${y}-${m}-${last}`, period_type: 'monthly' }))
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <PageToast message={toast?.message ?? null} type={toast?.type} />

      <div>
        <h1 className="text-xl font-bold text-slate-900">Reconciliation</h1>
        <p className="text-sm text-slate-500 mt-0.5">Verify all money movements and detect discrepancies</p>
      </div>

      {/* Formula */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-800">
        <strong>Reconciliation Formula:</strong><br />
        <span className="font-mono text-xs">
          Sales Revenue = Vendor Due + Developer Revenue + DistroGH Revenue<br />
          Expected Vendor Payable = Vendor Due − Returns − Deductions − Transport Charges − Completed Payouts
        </span>
      </div>

      {/* Run Form */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-slate-800">Run New Reconciliation</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Type</label>
            <select value={form.period_type} onChange={e => setForm(f => ({ ...f, period_type: e.target.value }))} className="input-base">
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Start Date *</label>
            <input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} className="input-base" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">End Date *</label>
            <input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} className="input-base" />
          </div>
          <button onClick={setCurrentMonth} className="btn-secondary text-xs">This Month</button>
          <button onClick={handleRun} disabled={running} className="btn-primary disabled:opacity-50">
            {running ? 'Running…' : 'Run Reconciliation'}
          </button>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-base w-full max-w-md" placeholder="Reason for reconciliation…" />
        </div>
      </div>

      {/* Past Runs */}
      <div>
        <h2 className="font-semibold text-slate-800 mb-3">Reconciliation History</h2>
        <div className="space-y-3">
          {loading ? (
            <p className="text-slate-400 text-sm text-center py-8">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No reconciliation runs yet.</p>
          ) : runs.map(run => (
            <div key={run.id} className={cn('bg-white rounded-xl border shadow-sm overflow-hidden', STATUS_COLOR[run.status] ? 'border-l-4' : '')}>
              <button
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 text-left"
              >
                <div className="flex items-center gap-4">
                  <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold border', STATUS_COLOR[run.status] ?? 'bg-slate-100 text-slate-600')}>
                    {run.status.toUpperCase()}
                  </span>
                  <span className="font-medium text-slate-800">
                    {run.period_type[0].toUpperCase()+run.period_type.slice(1)}: {fmtDate(run.period_start)} → {fmtDate(run.period_end)}
                  </span>
                  <span className={cn('text-sm font-mono', Math.abs(Number(run.variance)) < 0.01 ? 'text-emerald-600' : 'text-red-600')}>
                    Variance: {fmt(run.variance)} ({run.variance_pct}%)
                  </span>
                </div>
                <span className="text-slate-400 text-sm">{expanded === run.id ? '▲' : '▼'} {fmtDate(run.created_at)}</span>
              </button>

              {expanded === run.id && (
                <div className="px-5 pb-5 border-t border-slate-100">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    {[
                      { l: 'Total Sales Revenue',   v: fmt(run.total_sales_revenue),    c: 'text-slate-800' },
                      { l: 'Vendor Due',             v: fmt(run.total_vendor_due),        c: 'text-blue-700' },
                      { l: 'Developer Revenue',      v: fmt(run.total_developer_revenue), c: 'text-violet-700' },
                      { l: 'DistroGH Revenue',       v: fmt(run.total_distrogh_revenue),  c: 'text-emerald-700' },
                      { l: 'Returns Value',          v: fmt(run.total_returns_value),     c: 'text-orange-600' },
                      { l: 'Deductions',             v: fmt(run.total_deductions),        c: 'text-red-600' },
                      { l: 'Completed Payouts',      v: fmt(run.total_payouts_completed), c: 'text-slate-600' },
                      { l: 'Transport Charges',      v: fmt(run.total_transport_charges), c: 'text-slate-600' },
                      { l: 'Expected Vendor Balance',v: fmt(run.expected_vendor_payable), c: 'text-slate-700' },
                      { l: 'Actual Vendor Balance',  v: fmt(run.actual_vendor_balance_sum),'c': 'text-slate-700' },
                    ].map(r => (
                      <div key={r.l} className="bg-slate-50 rounded-lg p-3">
                        <p className={cn('font-bold', r.c)}>{r.v}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{r.l}</p>
                      </div>
                    ))}
                  </div>
                  {run.notes && <p className="mt-3 text-sm text-slate-600 italic">Note: {run.notes}</p>}
                  {run.created_by_email && <p className="mt-1 text-xs text-slate-400">Run by: {run.created_by_email} on {new Date(run.created_at).toLocaleString()}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

