'use client'

import { cn } from '@/lib/utils'

export type ReportColumn<T> = {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  className?: string
  render: (row: T, index: number) => React.ReactNode
}

type ReportDataTableProps<T> = {
  columns: ReportColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  stickyHeader?: boolean
  maxHeight?: string
  className?: string
}

export function ReportDataTable<T>({
  columns,
  rows,
  rowKey,
  stickyHeader = false,
  maxHeight,
  className,
}: ReportDataTableProps<T>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 overflow-hidden',
        maxHeight && 'overflow-y-auto',
        className
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="data-table w-full">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(241,245,249)]')}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="hover:bg-slate-50/80">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    col.align === 'right' && 'text-right tabular-nums',
                    col.align === 'center' && 'text-center',
                    col.className
                  )}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type TablePageSize = 10 | 25 | 'all'

type ReportTablePagerProps = {
  total: number
  pageSize: TablePageSize
  onPageSizeChange: (size: TablePageSize) => void
  className?: string
}

export function ReportTablePager({ total, pageSize, onPageSizeChange, className }: ReportTablePagerProps) {
  const options: { value: TablePageSize; label: string }[] = [
    { value: 10, label: 'Top 10' },
    { value: 25, label: 'Top 25' },
    { value: 'all', label: 'Show all' },
  ]
  const showing = pageSize === 'all' ? total : Math.min(pageSize, total)

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500', className)}>
      <span>
        Showing {showing} of {total} {total === 1 ? 'row' : 'rows'}
      </span>
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onPageSizeChange(opt.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              pageSize === opt.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export type { TablePageSize }
