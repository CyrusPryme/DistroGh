'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type SecurityEvent = {
  id: string
  actor_email?: string
  action: string
  module?: string
  ip_address?: string
  metadata?: Record<string, unknown>
  created_at: string
}

type IPEntry = {
  ip_address: string
  event_count: number
  last_seen: string
  actions: string[]
}

type LoginSlice = {
  hour: string
  success: number
  failed: number
}

type TopActor = {
  actor_email: string
  event_count: number
  last_active: string
}

type SecurityData = {
  events: SecurityEvent[]
  ip_activity: IPEntry[]
  login_timeline: LoginSlice[]
  top_actors: TopActor[]
  window_hours: number
  generated_at: string
}

const ACTION_COLORS: Record<string, string> = {
  login:                    'bg-emerald-100 text-emerald-700',
  logout:                   'bg-slate-100 text-slate-600',
  login_failed:             'bg-red-100 text-red-700',
  permission_denied:        'bg-orange-100 text-orange-700',
  create_developer_account: 'bg-violet-100 text-violet-700',
  reset_developer_password: 'bg-amber-100 text-amber-700',
  restore_record:           'bg-blue-100 text-blue-700',
}

export default function SecurityCenterPage() {
  const [data, setData] = useState<SecurityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hours, setHours] = useState(72)

  const load = async (h = hours) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/developer/security?hours=${h}`)
      const json = await res.json()
      if (json.success) setData(json.data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const fmtDate = (d: string) => new Date(d).toLocaleString()
  const maxEvents = data?.ip_activity.reduce((m, e) => Math.max(m, e.event_count), 1) ?? 1

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Security Center</h1>
          <p className="text-sm text-slate-500 mt-0.5">Login monitoring, IP activity and threat detection</p>
        </div>
        <div className="flex gap-2 items-center">
          <select value={hours} onChange={e => { setHours(Number(e.target.value)); load(Number(e.target.value)) }} className="input-base text-sm">
            <option value={24}>Last 24h</option>
            <option value={72}>Last 72h</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
          <button onClick={() => load()} disabled={loading} className="btn-secondary">{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-slate-400 text-center py-10">Loading security data…</p>
      ) : (
        <>
          {/* Login timeline */}
          {data?.login_timeline && data.login_timeline.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="font-semibold text-slate-800 mb-4">Login Activity (Last 48h)</h2>
              <div className="overflow-x-auto">
                <div className="flex gap-1 items-end h-24 min-w-0">
                  {data.login_timeline.map(s => {
                    const maxVal = Math.max(...data.login_timeline.map(x => x.success + x.failed), 1)
                    const h_succ = Math.round((s.success / maxVal) * 80)
                    const h_fail = Math.round((s.failed / maxVal) * 80)
                    return (
                      <div key={s.hour} className="flex flex-col items-center gap-0.5 min-w-6" title={`${s.hour}\nLogin: ${s.success}, Failed: ${s.failed}`}>
                        <div className="w-4 bg-red-400 rounded-t-sm" style={{ height: h_fail }}></div>
                        <div className="w-4 bg-emerald-400 rounded-t-sm" style={{ height: h_succ }}></div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-3 mt-2">
                  <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-3 h-3 bg-emerald-400 rounded-sm inline-block"></span>Success</span>
                  <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-3 h-3 bg-red-400 rounded-sm inline-block"></span>Failed</span>
                </div>
              </div>
            </div>
          )}

          {/* IP Activity */}
          {data?.ip_activity && (
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Top IP Addresses</h2>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      {['IP Address','Events','Last Seen','Actions'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.ip_activity.map(ip => (
                      <tr key={ip.ip_address} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{ip.ip_address}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 bg-violet-500 rounded-full" style={{ width: `${Math.round((ip.event_count / maxEvents) * 80)}px`, minWidth: '4px' }}></div>
                            <span className="text-sm font-medium text-slate-700">{ip.event_count}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(ip.last_seen)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {ip.actions.slice(0, 3).map(a => (
                              <span key={a} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{a}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Security Events */}
          <div>
            <h2 className="font-semibold text-slate-800 mb-3">Security Events</h2>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    {['Time','Actor','Action','IP Address'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!data?.events?.length ? (
                    <tr><td colSpan={4} className="py-8 text-center text-slate-400">No security events in this period.</td></tr>
                  ) : data.events.map(ev => (
                    <tr key={ev.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{fmtDate(ev.created_at)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{ev.actor_email ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ACTION_COLORS[ev.action] ?? 'bg-slate-100 text-slate-600')}>
                          {ev.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{ev.ip_address ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Actors */}
          {data?.top_actors && data.top_actors.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-800 mb-3">Most Active Users</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.top_actors.map(actor => (
                  <div key={actor.actor_email} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <p className="font-medium text-slate-800 text-sm truncate">{actor.actor_email}</p>
                    <p className="text-2xl font-bold text-violet-600 mt-1">{actor.event_count}</p>
                    <p className="text-xs text-slate-400 mt-0.5">events · last: {fmtDate(actor.last_active)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
