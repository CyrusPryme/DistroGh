'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import { FormModal } from '@/components/shared/FormModal'
import { DashboardSortableTable, type DashboardColumn } from '@/components/dashboard/DashboardSortableTable'
import { formatNumber, cn } from '@/lib/utils'
import { vendorActivityService } from '@/services/vendor-activity.service'
import type { VendorActivityProductRow } from '@/lib/vendor-activity'

type VendorActivityProductsModalProps = {
  open: boolean
  onClose: () => void
  vendorId: string
  vendorName: string
  periodLabel: string
  from?: string
  to?: string
  showVendorProfileLink?: boolean
}

export function VendorActivityProductsModal({
  open,
  onClose,
  vendorId,
  vendorName,
  periodLabel,
  from,
  to,
  showVendorProfileLink = true,
}: VendorActivityProductsModalProps) {
  const [products, setProducts] = useState<VendorActivityProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !vendorId) return
    setLoading(true)
    setError(null)
    vendorActivityService
      .getProducts({ vendorId, from, to })
      .then((res) => setProducts(res.products))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load products')
        setProducts([])
      })
      .finally(() => setLoading(false))
  }, [open, vendorId, from, to])

  const columns: DashboardColumn<VendorActivityProductRow>[] = useMemo(
    () => [
      {
        key: 'product',
        header: 'Product',
        sortable: true,
        sortValue: (r) => r.product_name,
        render: (r) => (
          <Link
            href={`/dashboard/vendors/stock-timeline?product_id=${encodeURIComponent(r.product_id)}&vendor_id=${encodeURIComponent(vendorId)}`}
            className="font-medium text-brand-700 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {r.product_name}
          </Link>
        ),
      },
      {
        key: 'received',
        header: 'Received',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.received,
        render: (r) => formatNumber(r.received),
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.delivered,
        render: (r) => formatNumber(r.delivered),
      },
      {
        key: 'sold',
        header: 'Sold',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.sold,
        render: (r) => formatNumber(r.sold),
      },
      {
        key: 'returns',
        header: 'Returns',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.returns,
        render: (r) => formatNumber(r.returns),
      },
      {
        key: 'warehouse_on_hand',
        header: 'WH on hand',
        align: 'right',
        sortable: true,
        sortValue: (r) => r.warehouse_gap,
        render: (r) =>
          r.warehouse_gap < 0 ? (
            <span
              className="inline-flex items-center justify-end gap-1 font-medium text-rose-700"
              title="Delivered more than ever received (all-time). This SKU's data likely needs correcting."
            >
              {formatNumber(r.warehouse_gap)}
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            </span>
          ) : (
            <span className={cn(r.warehouse_on_hand > 0 && 'font-medium text-slate-900')}>
              {formatNumber(r.warehouse_on_hand)}
            </span>
          ),
      },
    ],
    [vendorId]
  )

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={`${vendorName} — by product`}
      description={`Period: ${periodLabel}. Warehouse on hand is all-time.`}
      maxWidthClass="max-w-4xl"
      error={error}
    >
      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {showVendorProfileLink ? (
          <Link
            href={`/dashboard/vendors/${vendorId}`}
            className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
          >
            Open vendor profile
            <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
        <Link
          href={`/dashboard/vendors/stock-timeline?vendor_id=${encodeURIComponent(vendorId)}`}
          className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
        >
          Stock timeline (this vendor)
          <ExternalLink className="h-3 w-3" />
        </Link>
      </p>

      {products.some((p) => p.warehouse_gap < 0) ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Rows marked with <AlertTriangle className="inline h-3 w-3 align-text-bottom" /> show negative WH on hand —
            more was delivered than was ever received for that SKU. Check the intake and delivery records.
          </span>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading products…
        </div>
      ) : products.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No product activity for this period.</p>
      ) : (
        <div className="max-h-[min(60vh,520px)] overflow-y-auto">
          <DashboardSortableTable
            columns={columns}
            rows={products}
            rowKey={(r) => r.product_id}
            compact
          />
        </div>
      )}
    </FormModal>
  )
}
