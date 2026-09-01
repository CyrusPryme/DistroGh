'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export type ReportTypeKey = 'sales' | 'products' | 'vendors' | 'delivery' | 'full'

type ReportTypeTabsProps = {
  value: ReportTypeKey
  onChange: (key: ReportTypeKey) => void
  options: { key: ReportTypeKey; label: string; icon: LucideIcon }[]
  className?: string
}

export function ReportTypeTabs({ value, onChange, options, className }: ReportTypeTabsProps) {
  return (
    <div className={cn('no-print border-b border-slate-200', className)}>
      <div className="flex gap-1 overflow-x-auto pb-px scrollbar-none">
        {options.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              value === key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
