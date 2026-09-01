'use client'

import { ChevronLeft, ChevronRight, Rows3, Rows4 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDensity } from '@/hooks/useDensity'

export const DEFAULT_PAGE_SIZE = 15

/** Sentinel pageSize meaning "show every row, no slicing". */
export const ALL_PAGE_SIZE = -1

export const PAGE_SIZE_OPTIONS = [15, 25, 50, 100]

/** Above this many rows, "Show all" is hidden — a plain table isn't virtualized, so
 *  dumping thousands of rows into the DOM at once makes scrolling janky. */
const ALL_OPTION_MAX_ITEMS = 1000

export function getPageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  if (pageSize === ALL_PAGE_SIZE) return items
  const p = Math.max(1, page)
  const start = (p - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function getTotalPages(totalItems: number, pageSize: number): number {
  if (pageSize === ALL_PAGE_SIZE) return 1
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

interface PaginationBarProps {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  /** Omit to hide the "rows per page" selector (falls back to the old fixed-size behaviour). */
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  /** Hide the comfortable/compact row-density toggle (it's a global preference — usually only
   *  worth hiding if a page already renders one elsewhere and doesn't want it duplicated). */
  showDensityToggle?: boolean
  className?: string
}

export function PaginationBar({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  showDensityToggle = true,
  className,
}: PaginationBarProps) {
  const [density, setDensity] = useDensity()
  const totalPages = getTotalPages(totalItems, pageSize)
  const safePage = Math.min(Math.max(1, page), totalPages)
  const from = totalItems === 0 ? 0 : (safePage - 1) * (pageSize === ALL_PAGE_SIZE ? totalItems : pageSize) + 1
  const to = pageSize === ALL_PAGE_SIZE ? totalItems : Math.min(safePage * pageSize, totalItems)

  if (totalItems === 0) return null

  const showAllOption = totalItems <= ALL_OPTION_MAX_ITEMS
  // Always include the current size so the select never silently shows the wrong value
  // (e.g. a persisted 100 on a table whose default options are only [15,25,50]).
  const options = Array.from(new Set(pageSizeOptions.concat(pageSize === ALL_PAGE_SIZE ? [] : [pageSize]))).sort(
    (a, b) => a - b
  )

  const handlePageSizeChange = (next: number) => {
    onPageSizeChange?.(next)
    onPageChange(1)
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 py-3 px-4 border-t border-slate-200 text-sm text-slate-600 w-full',
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>
          Showing <span className="font-medium text-slate-800">{from}</span>–
          <span className="font-medium text-slate-800">{to}</span> of{' '}
          <span className="font-medium text-slate-800">{totalItems}</span>
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-slate-500">
            <span className="whitespace-nowrap">Rows per page</span>
            <select
              value={pageSize === ALL_PAGE_SIZE ? 'all' : pageSize}
              onChange={(e) => {
                const raw = e.target.value
                handlePageSizeChange(raw === 'all' ? ALL_PAGE_SIZE : Number(raw))
              }}
              className="border border-slate-200 rounded-lg pl-2 pr-7 py-1 text-slate-700 bg-white hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            >
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              {showAllOption && <option value="all">All</option>}
            </select>
          </label>
        )}
        {showDensityToggle && (
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0" role="group" aria-label="Row density">
            <button
              type="button"
              title="Comfortable rows"
              aria-pressed={density === 'comfortable'}
              onClick={() => setDensity('comfortable')}
              className={cn(
                'flex items-center px-2 py-1 transition-colors',
                density === 'comfortable' ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              )}
            >
              <Rows3 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Compact rows"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity('compact')}
              className={cn(
                'flex items-center px-2 py-1 border-l border-slate-200 transition-colors',
                density === 'compact' ? 'bg-brand-50 text-brand-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              )}
            >
              <Rows4 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
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
