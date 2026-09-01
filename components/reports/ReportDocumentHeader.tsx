'use client'

import { format } from 'date-fns'
import { BarChart3, CreditCard, ShoppingCart } from 'lucide-react'
import { KPICard } from '@/components/dashboard/KPICard'
import { cn } from '@/lib/utils'

type ReportDocumentHeaderProps = {
  rangeLabel: string
  generatedAt?: Date
  totalSales: number
  totalMarkup: number
  totalVendorDue: number
  className?: string
}

export function ReportDocumentHeader({
  rangeLabel,
  generatedAt = new Date(),
  totalSales,
  totalMarkup,
  totalVendorDue,
  className,
}: ReportDocumentHeaderProps) {
  return (
    <div className={cn('data-card border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/50', className)}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">Distribution Report</p>
          <h2 className="font-display text-xl lg:text-2xl font-bold text-slate-900 tracking-tight">
            DistroGH — Distribution Report
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {rangeLabel || 'Select period and generate'}
            </span>
            <span className="text-xs text-slate-400">
              Generated {format(generatedAt, 'dd MMM yyyy, HH:mm')}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        <KPICard compact title="Total sales" value={totalSales} icon={BarChart3} iconBg="bg-blue-50" iconColor="text-blue-600" isCurrency />
        <KPICard compact title="Total markup" value={totalMarkup} icon={ShoppingCart} iconBg="bg-violet-50" iconColor="text-violet-600" isCurrency />
        <KPICard compact title="Vendor payables" value={totalVendorDue} icon={CreditCard} iconBg="bg-emerald-50" iconColor="text-emerald-600" isCurrency subtitle="After return deductions" />
      </div>
    </div>
  )
}
