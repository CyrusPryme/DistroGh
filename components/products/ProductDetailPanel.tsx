'use client'

import { Package, Barcode, User, Layers, Calendar, Tag } from 'lucide-react'
import type { Product } from '@/types'
import { formatDate, formatGHS, cn } from '@/lib/utils'
import { resolveProductPriceTiers } from '@/lib/product-pricing'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'

type StockInfo = { on_hand: number } | null

function productStatus(product: Product): { label: string; tone: string } {
  const expiry = product.expiry_date?.trim()
  if (!expiry) return { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  const exp = new Date(expiry)
  const now = new Date()
  if (Number.isNaN(exp.getTime())) return { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (exp < now) return { label: 'Expired', tone: 'bg-red-50 text-red-700 border-red-200' }
  const days = Math.ceil((exp.getTime() - now.getTime()) / 86400000)
  if (days <= 30) return { label: 'Expiring soon', tone: 'bg-amber-50 text-amber-800 border-amber-200' }
  return { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-100 bg-slate-50/60 overflow-hidden">
      <h3 className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-white">
        {title}
      </h3>
      <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {children}
      </dl>
    </section>
  )
}

function DetailField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 mb-0.5">{label}</dt>
      <dd className={cn('text-slate-800 font-medium', mono && 'font-mono text-[13px]')}>{value}</dd>
    </div>
  )
}

interface ProductDetailPanelProps {
  open: boolean
  onClose: () => void
  product: Product | null
  stock?: StockInfo
  isAdmin: boolean
  onEdit?: () => void
}

export function ProductDetailPanel({ open, onClose, product, stock, isAdmin, onEdit }: ProductDetailPanelProps) {
  if (!product) return null

  const vendor = product.vendor as { name?: string } | undefined
  const { vendorPrice, distroMarkup, distroPrice, supermarketSellingPrice } = resolveProductPriceTiers(product)
  const status = productStatus(product)
  const imagePath = product.product_image_paths?.[0]

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Product details"
      description={product.name}
      maxWidthClass="max-w-2xl"
    >
      <FormModalBody className="space-y-4">
        <div className="flex gap-4 items-start">
          <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
            {imagePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagePath} alt="" className="w-full h-full object-cover" />
            ) : (
              <Package className="w-7 h-7 text-slate-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-semibold text-lg text-slate-900 leading-tight">{product.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={cn('status-badge border text-xs', status.tone)}>{status.label}</span>
              {product.category && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <Tag className="w-3 h-3" />
                  {product.category}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              {vendor?.name && (
                <span className="inline-flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  {vendor.name}
                </span>
              )}
              {product.barcode && (
                <span className="inline-flex items-center gap-1 font-mono text-[13px]">
                  <Barcode className="w-3.5 h-3.5 text-slate-400" />
                  {product.barcode}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-500">{isAdmin ? 'Distro price' : 'Your price'}</p>
            <p className="text-lg font-semibold font-mono text-slate-900">
              {formatGHS(isAdmin ? distroPrice : vendorPrice)}
            </p>
            {stock != null && (
              <p className="text-xs text-slate-500 mt-1">
                Warehouse: <span className="font-medium text-slate-700">{stock.on_hand}</span> on hand
              </p>
            )}
          </div>
        </div>

        <DetailSection title="Basic information">
          <DetailField label="Product name" value={product.name} />
          <DetailField label="Vendor" value={vendor?.name ?? '—'} />
          <DetailField label="Category" value={product.category?.trim() || '—'} />
          <DetailField label="Barcode" value={product.barcode?.trim() || '—'} mono />
        </DetailSection>

        <DetailSection title="Pricing details">
          <DetailField label="Vendor price" value={formatGHS(vendorPrice)} />
          {isAdmin && (
            <>
              <DetailField label="DistroGH markup" value={formatGHS(distroMarkup)} />
              <DetailField label="Distro price (supermarket)" value={formatGHS(distroPrice)} />
              <DetailField
                label="Supermarket retail"
                value={supermarketSellingPrice != null ? formatGHS(supermarketSellingPrice) : '—'}
              />
            </>
          )}
          <DetailField
            label="Wholesale price"
            value={
              product.wholesale_price != null && Number(product.wholesale_price) !== vendorPrice
                ? formatGHS(Number(product.wholesale_price))
                : 'Same as vendor price'
            }
          />
        </DetailSection>

        <DetailSection title="Inventory details">
          <DetailField label="Warehouse on hand" value={stock != null ? stock.on_hand : '—'} />
          <DetailField label="Packaging size" value={product.packaging_size?.trim() || '—'} />
          <DetailField label="MOQ" value={product.moq ?? 1} />
          <DetailField
            label="Expiry"
            value={product.expiry_date ? formatDate(product.expiry_date) : 'Non-perishable'}
          />
        </DetailSection>

        <DetailSection title="Advanced information">
          <DetailField label="SKU" value={product.sku?.trim() || '—'} mono />
          <DetailField label="Added" value={formatDate(product.created_at)} />
          <DetailField label="Last updated" value={formatDate(product.updated_at)} />
        </DetailSection>
      </FormModalBody>
      <FormModalFooter>
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>
          Close
        </button>
        {onEdit && (
          <button type="button" className="btn-primary flex-1" onClick={onEdit}>
            Edit product
          </button>
        )}
      </FormModalFooter>
    </FormModal>
  )
}
