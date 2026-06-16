'use client'

import React, { useState, useEffect, useRef } from 'react'
import { FileText, Search, RefreshCw, Download, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

interface AuditLog {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  module: string
  target_id: string | null
  target_label: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

interface Meta {
  total: number
  page: number
  limit: number
  pages: number
}

const ACTION_COLORS: Record<string, string> = {
  login: 'bg-blue-100 text-blue-700',
  logout: 'bg-slate-100 text-slate-600',
  create_admin_account: 'bg-emerald-100 text-emerald-700',
  update_admin_account: 'bg-amber-100 text-amber-700',
  delete_admin_account: 'bg-red-100 text-red-700',
  reset_password: 'bg-orange-100 text-orange-700',
  delivery_confirmed: 'bg-teal-100 text-teal-700',
  payout_approved: 'bg-green-100 text-green-700',
  vendor_approved: 'bg-purple-100 text-purple-700',
}

function actionBadge(action: string) {
  const cls = ACTION_COLORS[action] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={cn('px-2 py-0.5 rounded text-[10px] font-semibold', cls)}>
      {action.replace(/_/g, ' ')}
    </span>
  )
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 50, pages: 0 })
  const [filters, setFilters] = useState<{ modules: string[]; actions: string[] }>({ modules: [], actions: [] })
  const [loading, setLoading] = useState(true)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [module, setModule] = useState('')
  const [action, setAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Debounce search input → only fire fetch after user stops typing
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Reset to page 1 whenever filters change (prevents stale-page bug)
  const isMount = useRef(true)
  useEffect(() => {
    if (isMount.current) { isMount.current = false; return }
    setPage(1)
  }, [search, module, action, dateFrom, dateTo])

  // Manual refresh ticker — bump this to force a reload
  const [refreshTick, setRefreshTick] = useState(0)
  const load = () => setRefreshTick(t => t + 1)

  // Single fetch effect — AbortController ensures only the latest request wins
  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50' })
    if (search) params.set('search', search)
    if (module) params.set('module', module)
    if (action) params.set('action', action)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)

    fetch(`/api/admin/audit-logs?${params}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setLogs(json.data)
          setMeta(json.meta)
          setFilters(json.filters)
        }
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') console.error(e) })
      .finally(() => setLoading(false))

    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, module, action, dateFrom, dateTo, refreshTick])

  function exportCsv() {
    const headers = ['Date', 'Actor', 'Action', 'Module', 'Target', 'IP']
    const rows = logs.map((l) => [
      new Date(l.created_at).toISOString(),
      l.actor_email ?? '',
      l.action,
      l.module,
      l.target_label ?? l.target_id ?? '',
      l.ip_address ?? '',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
            <FileText className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Audit Logs</h1>
            <p className="text-xs text-slate-500">Track all system events and account activity</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={exportCsv} className="btn-primary flex items-center gap-1.5 text-sm">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          <Filter className="w-3.5 h-3.5" /> Filters
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search actor, action, module…"
              className="pl-9 input-base text-sm"
            />
          </div>
          <select value={module} onChange={(e) => setModule(e.target.value)} className="input-base text-sm w-44">
            <option value="">All Modules</option>
            {filters.modules.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="input-base text-sm w-52">
            <option value="">All Actions</option>
            {filters.actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-base text-sm w-36" title="From date" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-base text-sm w-36" title="To date" />
        </div>
      </div>

      {/* Stats */}
      <div className="text-xs text-slate-500">
        {meta.total.toLocaleString()} total entries · Page {meta.page} of {meta.pages || 1}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading audit logs…</div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No audit logs found.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500">
                <th className="text-left px-4 py-2.5 font-semibold">Date & Time</th>
                <th className="text-left px-4 py-2.5 font-semibold">Actor</th>
                <th className="text-left px-4 py-2.5 font-semibold">Action</th>
                <th className="text-left px-4 py-2.5 font-semibold">Module</th>
                <th className="text-left px-4 py-2.5 font-semibold">Target</th>
                <th className="text-left px-4 py-2.5 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.map((log) => {
                const isExp = expanded === log.id
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => setExpanded(isExp ? null : log.id)}
                      className="hover:bg-slate-50/60 transition cursor-pointer"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                        {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{log.actor_email ?? <span className="text-slate-400 italic">System</span>}</td>
                      <td className="px-4 py-2.5">{actionBadge(log.action)}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono">
                          {log.module}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-[180px] truncate">
                        {log.target_label ?? log.target_id ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono">{log.ip_address ?? '—'}</td>
                    </tr>
                    {isExp && log.metadata && (
                      <tr className="bg-slate-50">
                        <td colSpan={6} className="px-4 py-2">
                          <pre className="text-[10px] text-slate-600 font-mono bg-white border border-slate-100 rounded p-2 overflow-x-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-slate-200 hover:border-emerald-400 text-slate-600 disabled:opacity-40 transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-slate-500">Page {page} of {meta.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}
            disabled={page >= meta.pages}
            className="p-2 rounded-lg border border-slate-200 hover:border-emerald-400 text-slate-600 disabled:opacity-40 transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
