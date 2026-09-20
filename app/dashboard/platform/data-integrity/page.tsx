'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type IntegrityIssue = {
  severity: 'error' | 'warn' | 'info'
  area: string
  message: string
  count?: number
}

type IntegrityCounts = {
  vendors: number
  products: number
  intakes: number
  delivery_runs: number
  sales: number
  returns: number
  payouts: number
}

type IntegrityData = {
  issues: IntegrityIssue[]
  counts: IntegrityCounts
  verdict: 'solid' | 'functional' | 'not_solid'
  checked_at: string
}

const COUNT_LABELS: Record<keyof IntegrityCounts, string> = {
  vendors: 'Vendors',
  products: 'Products',
  intakes: 'Intakes',
  delivery_runs: 'Delivery runs',
  sales: 'Sales',
  returns: 'Returns',
  payouts: 'Payouts',
}

const SEVERITY_ORDER: IntegrityIssue['severity'][] = ['error', 'warn', 'info']

const SEVERITY_STYLE: Record<IntegrityIssue['severity'], string> = {
  error: 'bg-red-50 border-red-200 text-red-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-emerald-50 border-emerald-200 text-emerald-800',
}

const SEVERITY_LABEL: Record<IntegrityIssue['severity'], string> = {
  error: 'Error',
  warn: 'Warning',
  info: 'OK',
}

const VERDICT_STYLE: Record<IntegrityData['verdict'], string> = {
  solid: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  functional: 'bg-amber-50 border-amber-200 text-amber-800',
  not_solid: 'bg-red-50 border-red-200 text-red-800',
}

const VERDICT_LABEL: Record<IntegrityData['verdict'], string> = {
  solid: 'Solid — no blocking issues, no warnings',
  functional: 'Functional — no blocking errors, some warnings to review',
  not_solid: 'Not solid — blocking errors found',
}

export default function DataIntegrityPage() {
  const [data, setData] = useState<IntegrityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/developer/system-integrity', { cache: 'no-store' })
      const json = await res.json()
      if (json.success) {
        setData(json.data)
        setLastRefresh(new Date())
      } else {
        setError(json.error ?? 'Failed to load integrity scan')
      }
    } catch {
      setError('Failed to load integrity scan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const errors = data?.issues.filter((i) => i.severity === 'error') ?? []
  const warns = data?.issues.filter((i) => i.severity === 'warn') ?? []
  const infos = data?.issues.filter((i) => i.severity === 'info') ?? []

  const sortedIssues = data
    ? SEVERITY_ORDER.flatMap((sev) => data.issues.filter((i) => i.severity === sev))
    : []

  return (
    <div className="page-container">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Data Integrity</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Live stock-chain, catalog, payout and migration health checks across the whole database
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-slate-400">Last checked: {lastRefresh.toLocaleTimeString()}</span>
          )}
          <button onClick={load} disabled={loading} className="btn-secondary">
            {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {loading && !data ? (
        <p className="text-slate-400 text-center py-10">Running integrity scan…</p>
      ) : data ? (
        <>
          <div className={cn('rounded-xl border px-4 py-3 text-sm font-medium', VERDICT_STYLE[data.verdict])}>
            {VERDICT_LABEL[data.verdict]}
            <span className="ml-2 font-normal opacity-80">
              ({errors.length} error{errors.length === 1 ? '' : 's'}, {warns.length} warning
              {warns.length === 1 ? '' : 's'}, {infos.length} OK)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {(Object.keys(COUNT_LABELS) as Array<keyof IntegrityCounts>).map((key) => (
              <div key={key} className="bg-white rounded-xl border border-slate-200 p-3 text-center shadow-sm">
                <p className="text-xl font-bold text-slate-800">{Number(data.counts[key] ?? 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">{COUNT_LABELS[key]}</p>
              </div>
            ))}
          </div>

          <div>
            <h2 className="font-semibold text-slate-800 mb-3">Findings</h2>
            <div className="space-y-2">
              {sortedIssues.map((issue, idx) => (
                <div
                  key={`${issue.area}-${idx}`}
                  className={cn('flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm', SEVERITY_STYLE[issue.severity])}
                >
                  <div>
                    <span className="font-semibold uppercase text-xs tracking-wide mr-2">
                      {SEVERITY_LABEL[issue.severity]}
                    </span>
                    <span className="font-mono text-xs mr-2 opacity-70">[{issue.area}]</span>
                    <span>{issue.message}</span>
                  </div>
                  {issue.count != null ? (
                    <span className="shrink-0 font-semibold">{issue.count.toLocaleString()}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
