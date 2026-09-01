'use client'

import { cn } from '@/lib/utils'

type ReportChartCardProps = {
  title?: string
  subtitle?: string
  children: React.ReactNode
  className?: string
  height?: number
}

export function ReportChartCard({
  title,
  subtitle,
  children,
  className,
  height = 280,
}: ReportChartCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm print-hide-chart',
        className
      )}
    >
      {title ? (
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
        </div>
      ) : null}
      <div style={{ height }} className="w-full min-w-0">
        {children}
      </div>
    </div>
  )
}
