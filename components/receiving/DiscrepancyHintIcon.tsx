'use client'

import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type DiscrepancyHintIconProps = {
  message: string
  className?: string
}

export function DiscrepancyHintIcon({ message, className }: DiscrepancyHintIconProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={className ?? 'inline-flex shrink-0 rounded-full p-0.5 text-amber-600 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'}
            aria-label="Stock reconciliation note"
          >
            <Info className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm whitespace-normal text-left font-normal">
          {message}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
