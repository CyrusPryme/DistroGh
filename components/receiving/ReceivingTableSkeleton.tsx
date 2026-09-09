'use client'

import { cn } from '@/lib/utils'

type ReceivingTableSkeletonProps = {
  columns: number
  rows?: number
  className?: string
}

function ShimmerBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-4 rounded-md bg-gradient-to-r from-slate-100 via-slate-200/80 to-slate-100 bg-[length:200%_100%] animate-shimmer',
        className
      )}
    />
  )
}

export function ReceivingTableSkeleton({ columns, rows = 6, className }: ReceivingTableSkeletonProps) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Loading table">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-slate-300 border-t-brand-500 animate-spin" />
        Updating results…
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200/80">
        <div className="grid gap-px bg-slate-100 p-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, i) => (
            <ShimmerBar key={`h-${i}`} className="h-3 w-16" />
          ))}
        </div>
        <div className="divide-y divide-slate-100 bg-white">
          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className="grid items-center gap-3 p-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: columns }).map((_, col) => (
                <ShimmerBar
                  key={`${row}-${col}`}
                  className={cn(col === columns - 1 ? 'ml-auto w-12' : col === 0 ? 'w-full max-w-[200px]' : 'w-16')}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
