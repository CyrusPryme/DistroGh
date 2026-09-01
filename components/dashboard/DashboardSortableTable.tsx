'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DashboardColumn<T> = {
  key: string
  header: string
  align?: 'left' | 'right'
  sortable?: boolean
  sortValue?: (row: T) => string | number
  render: (row: T) => React.ReactNode
  className?: string
}

type SortDir = 'asc' | 'desc'

type DashboardSortableTableProps<T> = {
  columns: DashboardColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: React.ReactNode
  compact?: boolean
}

export function DashboardSortableTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  compact = true,
}: DashboardSortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
    return copy
  }, [rows, columns, sortKey, sortDir])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  if (!rows.length && empty) return <>{empty}</>

  return (
    <div className="data-table-wrapper -mx-1 overflow-x-auto">
      <table className={cn('data-table w-full', compact && 'text-sm')}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  col.align === 'right' && 'text-right',
                  col.sortable && 'cursor-pointer select-none hover:text-slate-700',
                  col.className
                )}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable ? (
                    sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="h-3 w-3 text-brand-600" />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-brand-600" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50/80">
              {columns.map((col) => (
                <td key={col.key} className={cn(col.align === 'right' && 'text-right', col.className)}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
