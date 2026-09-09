'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export type ReceivingViewTab = 'log' | 'stock'

export type ReceivingTabOption = {
  key: ReceivingViewTab
  label: string
  icon: LucideIcon
  /** Rows visible in the current filtered view */
  count: number
  /** Total before in-tab search (stock tab only) */
  totalCount?: number
  filtersActive?: boolean
}

type ReceivingViewTabsProps = {
  value: ReceivingViewTab
  onChange: (tab: ReceivingViewTab) => void
  options: ReceivingTabOption[]
  className?: string
}

export function ReceivingViewTabs({ value, onChange, options, className }: ReceivingViewTabsProps) {
  return (
    <div className={cn('border-b border-slate-200 bg-white rounded-t-xl', className)}>
      <div
        className="flex gap-1 overflow-x-auto px-1 pb-px scrollbar-none"
        role="tablist"
        aria-label="Receiving views"
      >
        {options.map(({ key, label, icon: Icon, count, totalCount, filtersActive }) => {
          const selected = value === key
          const showFilteredRatio =
            totalCount != null && totalCount !== count && filtersActive
          const badgeText = showFilteredRatio ? `${count}/${totalCount}` : String(count)
          const showBadge = filtersActive || count > 0 || selected

          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                selected
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              )}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-80" />
              {label}
              {showBadge ? (
                <span
                  className={cn(
                    'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    count === 0 && filtersActive
                      ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80'
                      : selected
                        ? 'bg-brand-100 text-brand-800'
                        : 'bg-slate-100 text-slate-600'
                  )}
                  title={
                    showFilteredRatio
                      ? `${count} matching current filters of ${totalCount} total`
                      : `${count} record${count === 1 ? '' : 's'}`
                  }
                >
                  {badgeText}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
