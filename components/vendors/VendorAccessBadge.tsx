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
        'status-badge text-[10px] font-semibold uppercase tracking-wide shrink-0 whitespace-nowrap',
        managed
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-indigo-50 text-indigo-700 border-indigo-200',
        className
      )}
    >
      {vendorAccessLabel(accessMode ?? undefined)}
    </span>
  )
}
