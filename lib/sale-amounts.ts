import type { Sale } from '@/types'
import { roundMoney } from '@/lib/utils'

/** Amounts recorded on the sale row at import time (not current product pricing). */
export function getSaleRecordedAmounts(sale: Sale): {
  totalSales: number
  vendorDue: number
  markupAmount: number
} {
  return {
    totalSales: roundMoney(Number(sale.total_sales ?? 0)),
    vendorDue: roundMoney(Number(sale.vendor_due ?? 0)),
    markupAmount: roundMoney(Number(sale.commission_amount ?? 0)),
  }
}

/** Shop unit price stored on the sale when it was imported. */
export function getSaleShopUnitPrice(sale: Sale): number {
  return roundMoney(Number(sale.unit_price ?? 0))
}

/** Vendor unit price implied by the imported sale (vendor_due ÷ qty). */
export function getSaleVendorUnitPrice(sale: Sale): number {
  const qty = Number(sale.qty_sold ?? 0)
  if (qty <= 0) return 0
  return roundMoney(Number(sale.vendor_due ?? 0) / qty)
}

/** Line total owed to vendor from the imported sale snapshot. */
export function getVendorLineTotal(sale: Sale): number {
  return getSaleRecordedAmounts(sale).vendorDue
}
