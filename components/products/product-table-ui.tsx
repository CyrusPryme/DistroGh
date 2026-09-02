'use client'

import { Package } from 'lucide-react'
import { formatDisplayName } from '@/lib/format-display-name'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Product } from '@/types'

export const LOW_STOCK_THRESHOLD = 10

export function mutedNA(label = 'N/A') {
  return <span className="text-xs text-slate-400">{label}</span>
}

export function TruncatedText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const value = text.trim()
  if (!value) return mutedNA()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('block truncate', className)}>{value}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs font-normal">
        {value}
      </TooltipContent>
    </Tooltip>
  )
}

export function ProductThumbnail({ product }: { product: Product }) {
  const imagePath = product.product_image_paths?.[0]
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      {imagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagePath} alt="" className="h-full w-full object-cover" />
      ) : (
        <Package className="h-4 w-4 text-slate-400" />
      )}
    </div>
  )
}

export function ProductIdentityCell({
  product,
  showVendor,
}: {
  product: Product
  showVendor?: boolean
}) {
  const vendor = product.vendor as { name?: string } | undefined
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProductThumbnail product={product} />
      <div className="min-w-0 max-w-[200px]">
        <TruncatedText text={formatDisplayName(product.name)} className="font-semibold text-slate-800" />
        {showVendor ? (
          vendor?.name?.trim() ? (
            <TruncatedText text={formatDisplayName(vendor.name)} className="mt-0.5 text-xs text-slate-500" />
          ) : (
            <span className="mt-0.5 block text-xs text-slate-400">N/A</span>
          )
        ) : null}
      </div>
    </div>
  )
}

export function StockBadge({ onHand }: { onHand: number | undefined }) {
  if (onHand == null) return mutedNA()
  if (onHand <= 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-red-700 ring-1 ring-inset ring-red-100">
        0
      </span>
    )
  }
  if (onHand <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800 ring-1 ring-inset ring-amber-100">
        {onHand}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700 ring-1 ring-inset ring-emerald-100">
      {onHand}
    </span>
  )
}

export const pinLeftCheck =
  'sticky left-0 z-[3] w-10 min-w-10 bg-white group-hover:bg-slate-50'
export const pinLeftProduct =
  'sticky left-10 z-[3] min-w-[240px] bg-white group-hover:bg-slate-50 shadow-[6px_0_8px_-6px_rgba(15,23,42,0.12)]'
export const pinRightValue =
  'sticky right-12 z-[3] bg-white group-hover:bg-slate-50 shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.12)]'
export const pinRightActions =
  'sticky right-0 z-[3] w-[6.5rem] min-w-[6.5rem] bg-white group-hover:bg-slate-50'
export const pinHead = 'sticky top-0 z-[4]'
