'use client'

import { cn } from '@/lib/utils'

type DataTableShellProps = {
  children: React.ReactNode
  pagination?: React.ReactNode
  className?: string
  tableMinWidth?: string
}

/** Bordered table card: horizontal scroll for the table, pagination stays pinned below. */
export function DataTableShell({ children, pagination, className, tableMinWidth }: DataTableShellProps) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="overflow-x-auto">
        <div style={tableMinWidth ? { minWidth: tableMinWidth } : undefined}>{children}</div>
      </div>
      {pagination ?? null}
    </div>
  )
}

type ListToolbarProps = {
  search?: React.ReactNode
  filters?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function ListToolbar({ search, filters, actions, className }: ListToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        {search}
        {filters}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 self-start lg:self-auto">{actions}</div> : null}
    </div>
  )
}
