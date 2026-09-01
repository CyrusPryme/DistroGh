'use client'

import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DASHBOARD_DATE_PRESETS,
  type DashboardDatePreset,
  type DashboardDateRange,
} from '@/lib/dashboard-date-range'

type DashboardDateRangePickerProps = {
  value: DashboardDateRange
  customFrom: string
  customTo: string
  onPresetChange: (preset: DashboardDatePreset) => void
  onCustomFromChange: (v: string) => void
  onCustomToChange: (v: string) => void
  className?: string
}

export function DashboardDateRangePicker({
  value,
  customFrom,
  customTo,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  className,
}: DashboardDateRangePickerProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      <div className="flex items-center gap-2 text-slate-600">
        <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Period</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DASHBOARD_DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPresetChange(p.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              value.preset === p.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFromChange(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomToChange(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          />
        </div>
      ) : value.preset !== 'all_time' ? (
        <span className="text-xs text-slate-500">
          {value.from} — {value.to}
        </span>
      ) : null}
    </div>
  )
}
