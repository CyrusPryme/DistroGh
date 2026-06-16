'use client'

import { useEffect, useState } from 'react'

type DBData = {
  database?: { db_size: string; db_name: string }
  tables?: Array<{ table_name: string; row_count: number; live_rows: number; dead_rows: number; total_size: string; size_bytes: number; seq_scan: number; idx_scan: number; last_autovacuum: string | null; last_autoanalyze: string | null }>
  indexes?: Array<{ index_name: string; table_name: string; idx_scan: number; index_size: string }>
  active_queries?: Array<{ pid: number; duration: string; state: string; query: string }>
  migrations?: Array<{ id: string; applied_at: string }>
  checked_at?: string
}

export default function DatabaseMonitoringPage() {
  const [data, setData] = useState<DBData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'tables' | 'indexes' | 'queries' | 'migrations'>('tables')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/developer/database')
      const json = await res.json()
      if (json.success) setData(json.data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleString() : '—'

  const tabs = ['tables', 'indexes', 'queries', 'migrations'] as const

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Database Monitoring</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data?.database ? `${data.database.db_name} · ${data.database.db_size}` : 'Loading…'}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">{loading ? '…' : 'Refresh'}</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <p className="text-slate-400 text-center py-10">Loading database stats…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {tab === 'tables' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {['Table','Live Rows','Dead Rows','Size','Seq Scans','Idx Scans','Last Vacuum','Last Analyze'].map(h => (
                    <th key={h} className="px-3 py-3 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.tables ?? []).map(t => (
                  <tr key={t.table_name} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{t.table_name}</td>
                    <td className="px-3 py-2.5 text-slate-600">{Number(t.live_rows).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-orange-600">{Number(t.dead_rows).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-500">{t.total_size}</td>
                    <td className="px-3 py-2.5 text-slate-500">{Number(t.seq_scan).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-slate-500">{Number(t.idx_scan).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDate(t.last_autovacuum)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{fmtDate(t.last_autoanalyze)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'indexes' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {['Index','Table','Scans','Size'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.indexes ?? []).map(idx => (
                  <tr key={idx.index_name} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{idx.index_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{idx.table_name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{Number(idx.idx_scan).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-500">{idx.index_size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'queries' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {['PID','Duration','State','Query'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!(data?.active_queries?.length) ? (
                  <tr><td colSpan={4} className="py-8 text-center text-slate-400">No active queries.</td></tr>
                ) : data.active_queries.map((q, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs">{q.pid}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{String(q.duration).split('.')[0]}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{q.state}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600 max-w-xs truncate">{q.query}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'migrations' && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {['Migration File','Applied At'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.migrations ?? []).map(m => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{m.id}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(m.applied_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data?.checked_at && <p className="text-xs text-slate-400 text-center">Data captured at {new Date(data.checked_at).toLocaleString()}</p>}
    </div>
  )
}
