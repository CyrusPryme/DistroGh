import { startOfWeek, parseISO } from 'date-fns'
import type { Sale, WeeklyRevenue, ProductPerformance, VendorSalesBreakdown, DashboardKPIs, ProductReturn } from '@/types'

/** Monday of the week containing dateStr (yyyy-MM-dd). */
function getWeekStart(dateStr: string): string {
  try {
    const d = parseISO(dateStr)
    const mon = startOfWeek(d, { weekStartsOn: 1 })
    return mon.toISOString().slice(0, 10)
  } catch {
    return dateStr
  }
}

export function aggregateSalesToReport(sales: Sale[]): {
  weekly: WeeklyRevenue[]
  products: ProductPerformance[]
  vendors: VendorSalesBreakdown[]
  kpis: DashboardKPIs
} {
  const weeklyMap = new Map<string, { total_sales: number; total_commission: number; total_vendor_due: number }>()
  const productMap = new Map<string, ProductPerformance>()
  const vendorMap = new Map<string, VendorSalesBreakdown>()

  for (const sale of sales) {
    const totalSales = Number(sale.total_sales ?? 0)
    const commission = Number(sale.commission_amount ?? 0)
    const vendorDue = Number(sale.vendor_due ?? 0)
    const product = sale.product as { id: string; name: string; vendor_id: string; vendor?: { id: string; name: string } } | undefined
    const weekStart = sale.week_start ?? ''

    if (weekStart) {
      const w = weeklyMap.get(weekStart) ?? { total_sales: 0, total_commission: 0, total_vendor_due: 0 }
      w.total_sales += totalSales
      w.total_commission += commission
      w.total_vendor_due += vendorDue
      weeklyMap.set(weekStart, w)
    }

    const pid = sale.product_id
    if (pid) {
      const existing = productMap.get(pid)
      if (existing) {
        existing.total_qty += sale.qty_sold ?? 0
        existing.total_sales += totalSales
      } else {
        productMap.set(pid, {
          product_id: pid,
          product_name: product?.name ?? 'Unknown',
          vendor_name: product?.vendor?.name ?? 'Unknown',
          total_qty: sale.qty_sold ?? 0,
          total_sales: totalSales,
        })
      }
    }

    const vid = product?.vendor_id ?? 'unknown'
    if (vid !== 'unknown') {
      const existing = vendorMap.get(vid)
      if (existing) {
        existing.total_sales += totalSales
        existing.total_commission += commission
        existing.total_vendor_due += vendorDue
      } else {
        vendorMap.set(vid, {
          vendor_id: vid,
          vendor_name: product?.vendor?.name ?? 'Unknown',
          total_sales: totalSales,
          total_commission: commission,
          total_vendor_due: vendorDue,
        })
      }
    }
  }

  const weekly: WeeklyRevenue[] = Array.from(weeklyMap.entries())
    .map(([week_start, v]) => ({ week_start, ...v }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))

  const products = Array.from(productMap.values()).sort((a, b) => b.total_sales - a.total_sales)
  const vendors = Array.from(vendorMap.values()).sort((a, b) => b.total_sales - a.total_sales)

  const totalSales = weekly.reduce((s, w) => s + Number(w.total_sales), 0)
  const totalCommission = weekly.reduce((s, w) => s + Number(w.total_commission), 0)
  const totalVendorDue = weekly.reduce((s, w) => s + Number(w.total_vendor_due), 0)

  const kpis: DashboardKPIs = {
    totalSales,
    totalCommission,
    totalVendorDue,
    vendorCount: vendorMap.size,
    productCount: productMap.size,
    pendingPayouts: 0,
  }

  return { weekly, products, vendors, kpis }
}

/**
 * Applies return deductions to an existing report aggregate.
 * Subtracts return amounts (and commission/vendor_due) from weekly, product, and vendor totals.
 */
export function applyReturnDeductions(
  report: { weekly: WeeklyRevenue[]; products: ProductPerformance[]; vendors: VendorSalesBreakdown[]; kpis: DashboardKPIs },
  returns: ProductReturn[]
): { weekly: WeeklyRevenue[]; products: ProductPerformance[]; vendors: VendorSalesBreakdown[]; kpis: DashboardKPIs } {
  const weeklyMap = new Map<string, { total_sales: number; total_commission: number; total_vendor_due: number }>()
  report.weekly.forEach((w) => weeklyMap.set(w.week_start, { ...w }))
  const productMap = new Map<string, ProductPerformance>()
  report.products.forEach((p) => productMap.set(p.product_id, { ...p }))
  const vendorMap = new Map<string, VendorSalesBreakdown>()
  report.vendors.forEach((v) => vendorMap.set(v.vendor_id, { ...v }))

  for (const r of returns) {
    const total = Number(r.quantity_returned ?? 0) * Number(r.unit_price ?? 0)
    const product = r.product as { id: string; name: string; vendor_id: string; vendor_price?: number; distrogh_markup?: number; vendor?: { id: string; name: string } } | undefined
    const qty = Number(r.quantity_returned ?? 0)
    const vendorPrice = Number(product?.vendor_price ?? 0)
    const distroghMarkup = Number(product?.distrogh_markup ?? 0)
    const vendorDue = qty * vendorPrice
    const commission = qty * distroghMarkup
    const weekStart = getWeekStart(r.return_date ?? '')
    const pid = r.product_id
    const vid = product?.vendor_id ?? ''

    if (weekStart) {
      const w = weeklyMap.get(weekStart) ?? { total_sales: 0, total_commission: 0, total_vendor_due: 0 }
      w.total_sales -= total
      w.total_commission -= commission
      w.total_vendor_due -= vendorDue
      weeklyMap.set(weekStart, w)
    }
    if (pid) {
      const existing = productMap.get(pid)
      if (existing) {
        existing.total_qty -= r.quantity_returned ?? 0
        existing.total_sales -= total
      } else {
        productMap.set(pid, {
          product_id: pid,
          product_name: product?.name ?? 'Unknown',
          vendor_name: product?.vendor?.name ?? 'Unknown',
          total_qty: -(r.quantity_returned ?? 0),
          total_sales: -total,
        })
      }
    }
    if (vid) {
      const existing = vendorMap.get(vid)
      if (existing) {
        existing.total_sales -= total
        existing.total_commission -= commission
        existing.total_vendor_due -= vendorDue
      } else {
        vendorMap.set(vid, {
          vendor_id: vid,
          vendor_name: product?.vendor?.name ?? 'Unknown',
          total_sales: -total,
          total_commission: -commission,
          total_vendor_due: -vendorDue,
        })
      }
    }
  }

  const weekly = Array.from(weeklyMap.entries())
    .map(([week_start, v]) => ({ week_start, ...v }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
  const products = Array.from(productMap.values()).sort((a, b) => b.total_sales - a.total_sales)
  const vendors = Array.from(vendorMap.values()).sort((a, b) => b.total_sales - a.total_sales)
  const totalSales = Math.max(0, weekly.reduce((s, w) => s + Number(w.total_sales), 0))
  const totalCommission = Math.max(0, weekly.reduce((s, w) => s + Number(w.total_commission), 0))
  const totalVendorDue = Math.max(0, weekly.reduce((s, w) => s + Number(w.total_vendor_due), 0))

  return {
    weekly,
    products,
    vendors,
    kpis: {
      ...report.kpis,
      totalSales,
      totalCommission,
      totalVendorDue,
    },
  }
}
