'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PageToast } from '@/components/shared/PageToast'

type RevenueRow = {
  label: string
  total_sales: number
  vendor_due: number
  developer_revenue: number
  distrogh_revenue: number
  total_qty: number
}

type Totals = {
  total_sales: number
  vendor_due: number
  developer_revenue: number
  distrogh_revenue: number
  total_qty: number
  record_count: number
}

type FeeConfig = {
  id: string
  name: string
  fee_type: string
  percentage_rate: number
  fixed_amount: number
  scope: string
  scope_id: string | null
  is_active: boolean
  effective_from: string | null
  effective_to: string | null
}

type Toast = { type: 'success' | 'error'; message: string } | null

export default function PlatformRevenuePage() {
  const [rows, setRows] = useState<RevenueRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [configs, setConfigs] = useState<FeeConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [cfgForm, setCfgForm] = useState({
    name: '', description: '', fee_type: 'percentage', percentage_rate: '0',
    fixed_amount: '0', hybrid_mode: 'max', scope: 'global', scope_id: '', is_active: true,
    effective_from: '', effective_to: '', priority: '0',
  })

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message }); setTimeout(() => setToast(null), 4000)
  }

  // Stable load — call explicitly on mount and on Apply click
  const loadRevenue = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ group_by: groupBy, limit: '100' })
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/developer/revenue?${params}`)
      const data = await res.json()
      if (data.success) { setRows(data.data); setTotals(data.totals) }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [groupBy, dateFrom, dateTo])

  const loadConfigs = useCallback(async () => {
    const res = await fetch('/api/developer/fee-configs')
    const data = await res.json()
    if (data.success) setConfigs(data.data)
  }, [])

  // Mount only — subsequent loads are triggered by the Apply button
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadRevenue(); loadConfigs() }, [])

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      const res = await fetch('/api/developer/fee-configs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cfgForm,
          percentage_rate: Number(cfgForm.percentage_rate),
          fixed_amount: Number(cfgForm.fixed_amount),
          priority: Number(cfgForm.priority),
          scope_id: cfgForm.scope === 'global' ? null : (cfgForm.scope_id || null),
          effective_from: cfgForm.effective_from || null,
          effective_to: cfgForm.effective_to || null,
        }),
      })
      const data = await res.json()
      if (!data.success) { showToast('error', data.error ?? 'Failed'); return }
      showToast('success', 'Fee configuration saved.')
      setShowConfigModal(false)
      loadConfigs()
    } catch { showToast('error', 'Network error') } finally { setSavingConfig(false) }
  }

  const handleToggleConfig = async (cfg: FeeConfig) => {
    await fetch(`/api/developer/fee-configs/${cfg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !cfg.is_active }),
    })
    loadConfigs()
  }

  const exportCSV = () => {
    const header = 'Period,Total Sales,Vendor Due,Developer Revenue,DistroGH Revenue,Qty Sold'
    const csv = [header, ...rows.map(r => [r.label, r.total_sales, r.vendor_due, r.developer_revenue, r.distrogh_revenue, r.total_qty].join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv])); a.download = `platform-revenue-${groupBy}.csv`; a.click()
  }

  const fmt = (n?: number | null) => n != null ? `GHS ${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2 })}` : '—'

  const scopeLabel = (cfg: FeeConfig) =>
    cfg.scope === 'global' ? 'Global' :
    `${cfg.scope[0].toUpperCase()}${cfg.scope.slice(1)}: ${cfg.scope_id ?? '—'}`

  const feeLabel = (cfg: FeeConfig) =>
    cfg.fee_type === 'percentage' ? `${cfg.percentage_rate}%` :
    cfg.fee_type === 'fixed' ? `GHS ${cfg.fixed_amount}/unit` :
    `max(${cfg.percentage_rate}%, GHS ${cfg.fixed_amount})`

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <PageToast message={toast?.message ?? null} type={toast?.type} />

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Platform Revenue</h1>
          <p className="text-sm text-slate-500 mt-0.5">Developer fee income and financial breakdown</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="btn-secondary">Export CSV</button>
          <button onClick={() => setShowConfigModal(true)} className="btn-primary">+ Fee Config</button>
        </div>
      </div>

      {/* Totals */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { l: 'Total Sales',       v: fmt(totals.total_sales),       c: 'text-slate-800' },
            { l: 'Vendor Due',        v: fmt(totals.vendor_due),         c: 'text-blue-700' },
            { l: 'Developer Revenue', v: fmt(totals.developer_revenue),  c: 'text-violet-700' },
            { l: 'DistroGH Revenue',  v: fmt(totals.distrogh_revenue),   c: 'text-emerald-700' },
          ].map(t => (
            <div key={t.l} className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
              <p className={cn('text-xl font-bold', t.c)}>{t.v}</p>
              <p className="text-xs text-slate-500 mt-1">{t.l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-white p-4 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Group by</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="input-base">
            {['day','month','year','vendor','product','supermarket','category'].map(v => (
              <option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base" />
        </div>
        <button onClick={loadRevenue} className="btn-primary">Apply</button>
      </div>

      {/* Revenue Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              {['Period / Group','Total Sales','Vendor Due','Developer Revenue','DistroGH Revenue','Qty'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">No data for the selected period.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{r.label}</td>
                <td className="px-4 py-3 text-slate-600">{fmt(r.total_sales)}</td>
                <td className="px-4 py-3 text-blue-700">{fmt(r.vendor_due)}</td>
                <td className="px-4 py-3 font-semibold text-violet-700">{fmt(r.developer_revenue)}</td>
                <td className="px-4 py-3 text-emerald-700">{fmt(r.distrogh_revenue)}</td>
                <td className="px-4 py-3 text-slate-500">{Number(r.total_qty ?? 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Fee Configurations */}
      <div>
        <h2 className="font-semibold text-slate-800 mb-3">Developer Fee Configurations</h2>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                {['Name','Type','Rate','Scope','Effective','Status','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {configs.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">No fee configurations yet.</td></tr>
              ) : configs.map(cfg => (
                <tr key={cfg.id} className={cn('hover:bg-slate-50', !cfg.is_active && 'opacity-50')}>
                  <td className="px-4 py-3 font-medium text-slate-800">{cfg.name}</td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{cfg.fee_type}</td>
                  <td className="px-4 py-3 text-violet-700 font-mono">{feeLabel(cfg)}</td>
                  <td className="px-4 py-3 text-slate-600">{scopeLabel(cfg)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {cfg.effective_from ?? '—'} → {cfg.effective_to ?? '∞'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium',
                      cfg.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    )}>
                      {cfg.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggleConfig(cfg)} className={cn('text-xs hover:underline', cfg.is_active ? 'text-red-600' : 'text-emerald-600')}>
                      {cfg.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Fee Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">New Fee Configuration</h2>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input value={cfgForm.name} onChange={e => setCfgForm(f => ({ ...f, name: e.target.value }))} className="input-base w-full" placeholder="e.g. Global 2% Fee" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fee Type *</label>
                <select value={cfgForm.fee_type} onChange={e => setCfgForm(f => ({ ...f, fee_type: e.target.value }))} className="input-base w-full">
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed per Unit</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Scope *</label>
                <select value={cfgForm.scope} onChange={e => setCfgForm(f => ({ ...f, scope: e.target.value }))} className="input-base w-full">
                  <option value="global">Global</option>
                  <option value="vendor">Vendor</option>
                  <option value="product">Product</option>
                  <option value="category">Category</option>
                </select>
              </div>
            </div>

            {cfgForm.fee_type !== 'fixed' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Percentage Rate (%)</label>
                <input type="number" value={cfgForm.percentage_rate} onChange={e => setCfgForm(f => ({ ...f, percentage_rate: e.target.value }))} className="input-base w-full" step="0.01" min="0" />
              </div>
            )}
            {cfgForm.fee_type !== 'percentage' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fixed Amount (GHS per unit)</label>
                <input type="number" value={cfgForm.fixed_amount} onChange={e => setCfgForm(f => ({ ...f, fixed_amount: e.target.value }))} className="input-base w-full" step="0.01" min="0" />
              </div>
            )}
            {cfgForm.fee_type === 'hybrid' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Hybrid Mode</label>
                <select value={cfgForm.hybrid_mode} onChange={e => setCfgForm(f => ({ ...f, hybrid_mode: e.target.value }))} className="input-base w-full">
                  <option value="max">Max (whichever is larger)</option>
                  <option value="min">Min (whichever is smaller)</option>
                  <option value="sum">Sum (add both)</option>
                </select>
              </div>
            )}

            {cfgForm.scope !== 'global' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {cfgForm.scope === 'category' ? 'Category Name' : `${cfgForm.scope[0].toUpperCase()}${cfgForm.scope.slice(1)} ID (UUID)`}
                </label>
                <input value={cfgForm.scope_id} onChange={e => setCfgForm(f => ({ ...f, scope_id: e.target.value }))} className="input-base w-full" placeholder={cfgForm.scope === 'category' ? 'e.g. Beverages' : 'UUID'} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Effective From</label>
                <input type="date" value={cfgForm.effective_from} onChange={e => setCfgForm(f => ({ ...f, effective_from: e.target.value }))} className="input-base w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Effective To (blank = no end)</label>
                <input type="date" value={cfgForm.effective_to} onChange={e => setCfgForm(f => ({ ...f, effective_to: e.target.value }))} className="input-base w-full" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="cfg-active" checked={cfgForm.is_active} onChange={e => setCfgForm(f => ({ ...f, is_active: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="cfg-active" className="text-sm text-slate-700">Active immediately</label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowConfigModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSaveConfig} disabled={savingConfig} className="btn-primary disabled:opacity-50">
                {savingConfig ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

