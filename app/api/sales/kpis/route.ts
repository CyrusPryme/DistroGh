import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export async function GET() {
  try {
    await requireAdminSession()
    const pool = getDbPool()

    const [salesAgg, vendorCount, productCount, pendingPayouts] = await Promise.all([
      pool.query(
        `
        select
          coalesce(sum(total_sales), 0) as total_sales,
          coalesce(sum(commission_amount), 0) as total_commission,
          coalesce(sum(vendor_due), 0) as total_vendor_due
        from public.sales
        where deleted_at is null
        `
      ),
      pool.query(`select count(*)::int as count from public.vendors where deleted_at is null`),
      pool.query(`select count(*)::int as count from public.products where deleted_at is null`),
      pool.query(`select coalesce(sum(amount_due), 0) as pending from public.payouts where deleted_at is null and status = 'pending'`),
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
