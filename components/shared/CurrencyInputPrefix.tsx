import { cn } from '@/lib/utils'

/** Prefix for money inputs — use with className "form-input pl-11" on the field. */
export function CurrencyInputPrefix({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold tracking-wide',
        className
      )}
      aria-hidden
    >
      GHS
    </span>
  )
}
