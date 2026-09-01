import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { parseQueryDateRange, salesWeekStartFilter } from '@/lib/api/query-date-range'
import { sqlEffectiveDistroMarkup } from '@/lib/sale-amounts'

export async function GET(req: Request) {
  try {
    await requireAdminSession()
    const pool = getDbPool()
    const { from, to } = parseQueryDateRange(new URL(req.url))

    const salesParams: unknown[] = []
    let salesWhere = 'where s.deleted_at is null'
    if (from && to) {
      salesParams.push(from, to)
      salesWhere += ` ${salesWeekStartFilter('s', 1, 2)}`
    }

    const [salesAgg, vendorCount, productCount, pendingPayouts] = await Promise.all([
      pool.query(
        `
        select
          coalesce(sum(s.total_sales), 0) as total_sales,
          coalesce(sum(${sqlEffectiveDistroMarkup('s', 'p')}), 0) as total_commission,
          coalesce(sum(s.vendor_due), 0) as total_vendor_due
        from public.sales s
        join public.products p on p.id = s.product_id
        ${salesWhere}
        `,
        salesParams
      ),
      pool.query(`select count(*)::int as count from public.vendors where deleted_at is null`),
      pool.query(`select count(*)::int as count from public.products where deleted_at is null`),
      pool.query(
        `select coalesce(sum(amount_due), 0) as pending from public.payouts where deleted_at is null and status = 'pending'`
      ),
    ])

    const s = salesAgg.rows?.[0] ?? {}

    return NextResponse.json({
      success: true,
      data: {
        totalSales: Number(s.total_sales ?? 0),
        totalCommission: Number(s.total_commission ?? 0),
        totalVendorDue: Number(s.total_vendor_due ?? 0),
        vendorCount: Number(vendorCount.rows?.[0]?.count ?? 0),
        productCount: Number(productCount.rows?.[0]?.count ?? 0),
        pendingPayouts: Number(pendingPayouts.rows?.[0]?.pending ?? 0),
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load KPIs. Is Postgres running?')
  }
}
