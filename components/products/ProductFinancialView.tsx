'use client'

import Link from 'next/link'
import { formatGHS, cn } from '@/lib/utils'
import {
  computeMarkupPercent,
  formatMarkupPercentLabel,
  resolveProductPriceTiers,
} from '@/lib/product-pricing'
import { formatDisplayName } from '@/lib/format-display-name'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Product } from '@/types'
import {
  mutedNA,
  ProductIdentityCell,
  StockBadge,
  TruncatedText,
} from '@/components/products/product-table-ui'

type ProductFinancialViewProps = {
  products: Product[]
  stockByProduct: Map<string, number>
  isAdmin: boolean
  onRowClick: (product: Product) => void
  renderActions: (product: Product) => React.ReactNode
}

function MarkupCell({ amount, percent }: { amount: number; percent: number | null }) {
  const label = percent != null ? formatMarkupPercentLabel(percent) : null
  const positive = percent != null && percent > 0
  const inner = (
    <span className="whitespace-nowrap tabular-nums">
      <span className="font-medium text-slate-800">{formatGHS(amount)}</span>
      {label ? (
        <span className={cn('ml-1 text-[11px] font-semibold', positive ? 'text-emerald-600' : 'text-slate-400')}>
          ({label})
        </span>
      ) : (
        <span className="ml-1">{mutedNA()}</span>
      )}
    </span>
  )

  if (percent == null) return inner

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-right" onClick={(e) => e.stopPropagation()}>
          {inner}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem] space-y-1 font-normal leading-relaxed">
        <p>Markup % = (Selling Price − Vendor Price) / Vendor Price</p>
      </TooltipContent>
    </Tooltip>
  )
}

function MoneyPair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right tabular-nums text-slate-800">{children}</span>
    </div>
  )
}

export function ProductFinancialView({
  products,
  stockByProduct,
  isAdmin,
  onRowClick,
  renderActions,
}: ProductFinancialViewProps) {
  return (
    <>
      <div className="hidden md:block">
        <table className="data-table min-w-[960px]">
          <thead>
            <tr>
              <th className="min-w-[220px]">Product</th>
              {isAdmin && <th className="min-w-[140px]">Vendor</th>}
              <th>Barcode</th>
              <th className="min-w-[120px] text-right whitespace-nowrap">
                {isAdmin ? 'Selling price' : 'Your price'}
              </th>
              {isAdmin && <th className="min-w-[128px] text-right">Markup</th>}
              {isAdmin && <th className="min-w-[100px] text-right whitespace-nowrap">Shelf price</th>}
              <th className="min-w-[80px] text-right">Stock</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const vendor = product.vendor as { name?: string } | undefined
              const { vendorPrice, distroMarkup, distroPrice, supermarketSellingPrice } =
                resolveProductPriceTiers(product)
              const percent = computeMarkupPercent(distroPrice, vendorPrice)
              const onHand = stockByProduct.get(product.id)

              return (
                <tr
                  key={product.id}
                  className="cursor-pointer hover:bg-slate-50/80"
                  onClick={() => onRowClick(product)}
                >
                  <td className="min-w-[220px] max-w-[280px]">
                    <ProductIdentityCell product={product} />
                  </td>
                  {isAdmin && (
                    <td className="min-w-[140px] max-w-[180px]">
                      <Link
                        href={`/dashboard/vendors/${product.vendor_id}`}
                        className="block text-sm text-brand-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <TruncatedText text={formatDisplayName(vendor?.name)} />
                      </Link>
                    </td>
                  )}
                  <td className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {product.barcode?.trim() ? product.barcode.trim() : mutedNA()}
                  </td>
                  <td className="text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                    {formatGHS(isAdmin ? distroPrice : vendorPrice)}
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <MarkupCell amount={distroMarkup} percent={percent} />
                    </td>
                  )}
                  {isAdmin && (
                    <td className="text-right tabular-nums text-slate-600 whitespace-nowrap">
                      {supermarketSellingPrice != null ? formatGHS(supermarketSellingPrice) : mutedNA()}
                    </td>
                  )}
                  <td className="text-right">
                    <StockBadge onHand={onHand} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>{renderActions(product)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-slate-100">
        {products.map((product) => {
          const vendor = product.vendor as { name?: string } | undefined
          const { vendorPrice, distroMarkup, distroPrice, supermarketSellingPrice } =
            resolveProductPriceTiers(product)
          const percent = computeMarkupPercent(distroPrice, vendorPrice)
          const onHand = stockByProduct.get(product.id)

          return (
            <div
              key={product.id}
              className="space-y-3 p-4 active:bg-slate-50"
              onClick={() => onRowClick(product)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onRowClick(product)}
            >
              <div className="flex items-start gap-3">
                <ProductIdentityCell product={product} />
                <div className="shrink-0">{renderActions(product)}</div>
              </div>
              {isAdmin && vendor?.name?.trim() ? (
                <p className="text-sm text-slate-500">{formatDisplayName(vendor.name)}</p>
              ) : null}
              <p className="font-mono text-xs text-slate-500">
                {product.barcode?.trim() || 'N/A'}
              </p>
              <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                <MoneyPair label={isAdmin ? 'Selling price' : 'Your price'}>
                  <span className="font-semibold">{formatGHS(isAdmin ? distroPrice : vendorPrice)}</span>
                </MoneyPair>
                {isAdmin && (
                  <MoneyPair label="Markup">
                    <MarkupCell amount={distroMarkup} percent={percent} />
                  </MoneyPair>
                )}
                {isAdmin && (
                  <MoneyPair label="Shelf price">
                    {supermarketSellingPrice != null ? formatGHS(supermarketSellingPrice) : mutedNA()}
                  </MoneyPair>
                )}
                <MoneyPair label="Stock">
                  <StockBadge onHand={onHand} />
                </MoneyPair>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
