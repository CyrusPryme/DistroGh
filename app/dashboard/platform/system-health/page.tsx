'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type HealthData = {
  pg_version?: string
  connections?: { total: number; active: number }
  tables?: Array<{ table_name: string; row_count: number; total_size: string }>
  migrations?: Array<{ id: string; applied_at: string }>
  security_events_24h?: Array<{ action: string; count: number }>
  platform_stats?: Record<string, number>
  checked_at?: string
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/developer/system-health')
      const json = await res.json()
      if (json.success) { setData(json.data); setLastRefresh(new Date()) }
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const statLabels: Record<string, string> = {
    vendor_count: 'Vendors', product_count: 'Products', sale_count: 'Sales',
    payout_count: 'Payouts', audit_log_count: 'Audit Logs', delivery_count: 'Deliveries',
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">System Health</h1>
          <p className="text-sm text-slate-500 mt-0.5">Database, connection and platform metrics</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-xs text-slate-400">Last checked: {lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={load} disabled={loading} className="btn-secondary">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-slate-400 text-center py-10">Loading health data…</p>
      ) : (
        <>
          {/* DB Connection + Version */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs text-slate-500 uppercase font-semibold mb-2">Database</p>
              <p className="text-2xl font-bold text-emerald-600">Online</p>
              <p className="text-xs text-slate-400 mt-1 truncate">{data?.pg_version?.split(' ').slice(0, 2).join(' ')}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs text-slate-500 uppercase font-semibold mb-2">Connections</p>
              <p className="text-2xl font-bold text-slate-800">{data?.connections?.active ?? '—'} active</p>
              <p className="text-xs text-slate-400 mt-1">{data?.connections?.total ?? '—'} total</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs text-slate-500 uppercase font-semibold mb-2">Migrations Applied</p>
              <p className="text-2xl font-bold text-slate-800">{data?.migrations?.length ?? '—'}</p>
              <p className="text-xs text-slate-400 mt-1">Latest: {data?.migrations?.at(-1)?.id ?? '—'}</p>
            </div>
          </div>

          {/* Platform Stats */}
          {data?.platform_stats && (
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Platform Statistics</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {Object.entries(data.platform_stats).map(([key, val]) => (
                  <div key={key} className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                    <p className="text-xl font-bold text-slate-800">{Number(val).toLocaleString()}</p>
                    <p className="text-xs text-slate-500 mt-1">{statLabels[key] ?? key}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security Events */}
          {data?.security_events_24h && data.security_events_24h.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Security Events (Last 24h)</h2>
              <div className="flex gap-3 flex-wrap">
                {data.security_events_24h.map(ev => (
                  <div key={ev.action} className={cn('px-4 py-2 rounded-lg border text-sm', ev.action === 'login_failed' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
                    <span className="font-semibold">{ev.count}</span> {ev.action.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table Sizes */}
          {data?.tables && (
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Table Sizes</h2>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      {['Table','Rows','Size'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.tables.map(t => (
                      <tr key={t.table_name} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{t.table_name}</td>
                        <td className="px-4 py-2.5 text-slate-600">{Number(t.row_count).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-slate-500">{t.total_size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Migration History */}
          {data?.migrations && (
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Migration History</h2>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      {['Migration','Applied At'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...data.migrations].reverse().map(m => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{m.id}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{new Date(m.applied_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
