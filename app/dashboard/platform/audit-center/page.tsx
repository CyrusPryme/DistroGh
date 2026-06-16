'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type AuditLog = {
  id: string
  actor_id?: string
  actor_email?: string
  actor_role?: string
  action: string
  module?: string
  target_id?: string
  target_label?: string
  ip_address?: string
  metadata?: Record<string, unknown>
  created_at: string
}

export default function AuditCenterPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [module, setModule] = useState('')
  const [action, setAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [modules, setModules] = useState<string[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const perPage = 50

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable load function — deps are all filters, NOT page (page passed as arg)
  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(perPage), offset: String((p - 1) * perPage),
        ...(search && { search }),
        ...(module && { module }),
        ...(action && { action }),
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
      })
      const res = await fetch(`/api/admin/audit-logs?${params}`)
      const data = await res.json()
      if (data.success) {
        setLogs(data.data ?? [])
        setTotal(data.total ?? 0)
        if (data.modules) setModules(data.modules)
        if (data.actions) setActions(data.actions)
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [search, module, action, dateFrom, dateTo])

  // When filters change: reset to page 1 and load. Guards against double-load by
  // using a ref to suppress the page-change effect that would otherwise also fire.
  const filterChanging = useRef(false)
  useEffect(() => {
    filterChanging.current = true
    setPage(1)
    load(1)
  }, [search, module, action, dateFrom, dateTo, load])

  // When the user explicitly changes page (not from a filter reset)
  useEffect(() => {
    if (filterChanging.current) { filterChanging.current = false; return }
    load(page)
  }, [page, load])

  const handleSearch = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    // filter change handled by useEffect above after debounce
    searchTimer.current = setTimeout(() => {
      /* search state already updated — useEffect handles load */
    }, 300)
  }

  const exportCSV = () => {
    const header = 'Date,Actor,Role,Action,Module,Target,IP'
    const csv = [header, ...logs.map(l => [
      new Date(l.created_at).toISOString(), l.actor_email ?? '', l.actor_role ?? '',
      l.action, l.module ?? '', l.target_label ?? l.target_id ?? '', l.ip_address ?? ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv]))
    a.download = 'audit-center.csv'
    a.click()
  }

  const fmtDate = (d: string) => new Date(d).toLocaleString()
  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Audit Center</h1>
          <p className="text-sm text-slate-500 mt-0.5">Immutable, fully searchable platform audit trail</p>
        </div>
        <button onClick={exportCSV} className="btn-secondary">Export CSV</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-white p-4 rounded-xl border border-slate-200">
        <input
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search actor, action, target…"
          className="input-base flex-1 min-w-48"
        />
        <select value={module} onChange={e => setModule(e.target.value)} className="input-base">
          <option value="">All Modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} className="input-base">
          <option value="">All Actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base" />
      </div>

      <p className="text-sm text-slate-500">{total.toLocaleString()} events</p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              {['Time','Actor','Role','Action','Module','Target','IP','Details'].map(h => (
                <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400">No audit logs found.</td></tr>
            ) : logs.map(log => (
              <React.Fragment key={log.id}>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(log.created_at)}</td>
                  <td className="px-4 py-3 text-slate-700 text-xs">{log.actor_email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{log.actor_role ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800 text-xs">{log.action}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{log.module ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-32">
                    {log.target_label ?? log.target_id ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{log.ip_address ?? '—'}</td>
                  <td className="px-4 py-3">
                    {log.metadata && (
                      <button
                        onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {expanded === log.id ? 'Hide' : 'Show'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === log.id && log.metadata && (
                  <tr className="bg-slate-50">
                    <td colSpan={8} className="px-4 py-2">
                      <pre className="text-xs text-slate-600 overflow-x-auto">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-secondary disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-4 py-2 text-sm text-slate-600">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
