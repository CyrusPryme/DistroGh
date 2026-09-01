'use client'

import { Loader2, BarChart3, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { REPORT_DATE_PRESETS, type ReportDatePresetKey } from '@/lib/reports-date-range'

type ReportsToolbarProps = {
  datePreset: ReportDatePresetKey
  customStart: string
  customEnd: string
  loading: boolean
  rangeHint?: string
  onPresetChange: (key: ReportDatePresetKey) => void
  onCustomStartChange: (v: string) => void
  onCustomEndChange: (v: string) => void
  onGenerate: () => void
}

export function ReportsToolbar({
  datePreset,
  customStart,
  customEnd,
  loading,
  rangeHint,
  onPresetChange,
  onCustomStartChange,
  onCustomEndChange,
  onGenerate,
}: ReportsToolbarProps) {
  return (
    <div className="no-print rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-center gap-2 text-slate-600">
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Report period</span>
      </div>

      {/* Segmented preset control */}
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {REPORT_DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPresetChange(p.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
              datePreset === p.key
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          {datePreset === 'custom' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => onCustomStartChange(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => onCustomEndChange(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </>
          ) : rangeHint ? (
            <p className="text-xs text-slate-500 pb-2">{rangeHint}</p>
          ) : null}

          <button
            type="button"
            onClick={onGenerate}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-slate-800 disabled:opacity-60 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            {loading ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </div>
    </div>
  )
}
