import { cn } from '@/lib/utils'
import { vendorAccessDescription, vendorAccessLabel } from '@/lib/vendor-access'
import type { VendorAccessMode } from '@/types'

interface VendorAccessBadgeProps {
  accessMode?: VendorAccessMode | null
  className?: string
  showTitle?: boolean
}

export function VendorAccessBadge({ accessMode, className, showTitle = true }: VendorAccessBadgeProps) {
  const managed = accessMode === 'admin_managed'
  return (
    <span
      title={showTitle ? vendorAccessDescription(accessMode ?? undefined) : undefined}
      className={cn(
        'status-badge text-[10px] uppercase tracking-wide shrink-0',
        managed
          ? 'bg-amber-100 text-amber-800 border-amber-200'
          : 'bg-emerald-100 text-emerald-800 border-emerald-200',
        className
      )}
    >
      {vendorAccessLabel(accessMode ?? undefined)}
    </span>
  )
}
