'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DEFAULT_PAGE_SIZE = 15

export function getPageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  const p = Math.max(1, page)
  const start = (p - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function getTotalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

interface PaginationBarProps {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  className?: string
}

export function PaginationBar({
  page,
  pageSize,
  totalItems,
  onPageChange,
  className,
}: PaginationBarProps) {
  const totalPages = getTotalPages(totalItems, pageSize)
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, totalItems)

  if (totalItems === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 py-3 px-1 border-t border-slate-100 text-sm text-slate-600',
        className
      )}
    >
      <span>
        Showing <span className="font-medium text-slate-800">{from}</span>–
        <span className="font-medium text-slate-800">{to}</span> of{' '}
        <span className="font-medium text-slate-800">{totalItems}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
        <span className="text-slate-500 tabular-nums px-1">
          Page {safePage} of {totalPages}
        </span>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
