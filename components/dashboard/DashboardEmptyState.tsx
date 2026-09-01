'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

type DashboardEmptyStateProps = {
  icon: LucideIcon
  title: string
  description?: string
  className?: string
}

export function DashboardEmptyState({ icon: Icon, title, description, className }: DashboardEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center',
        className
      )}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/80">
        <Icon className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="mt-1 max-w-xs text-xs text-slate-500">{description}</p> : null}
    </div>
  )
}
