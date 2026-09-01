'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

type ReportSectionCardProps = {
  title: string
  icon: LucideIcon
  iconClass?: string
  children: React.ReactNode
  className?: string
}

export function ReportSectionCard({
  title,
  icon: Icon,
  iconClass,
  children,
  className,
}: ReportSectionCardProps) {
  return (
    <section className={cn('data-card space-y-5', className)}>
      <h3 className="font-display flex items-center gap-2 text-base font-semibold text-slate-900">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50', iconClass)}>
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}
