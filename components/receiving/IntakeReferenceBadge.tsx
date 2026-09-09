'use client'

import { cn } from '@/lib/utils'
import {
  intakeReferenceToneClass,
  parseIntakeReference,
  type IntakeReferenceBadge as BadgeModel,
} from '@/lib/intake-reference-display'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type IntakeReferenceBadgeProps = {
  reference: string | null | undefined
  className?: string
}

export function IntakeReferenceBadge({ reference, className }: IntakeReferenceBadgeProps) {
  const badge: BadgeModel | null = parseIntakeReference(reference)
  if (!badge) {
    return <span className="text-slate-400 text-sm">—</span>
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'status-badge border text-[11px] font-medium cursor-default max-w-[140px] truncate inline-block',
              intakeReferenceToneClass(badge.tone),
              className
            )}
          >
            {badge.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal">
          {badge.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
