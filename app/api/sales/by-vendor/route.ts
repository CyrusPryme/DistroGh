import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function GET() {
  try {
    await requireAdminSession()
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select
        v.id as vendor_id,
        v.name as vendor_name,
        coalesce(sum(s.total_sales), 0) as total_sales,
        coalesce(sum(s.commission_amount), 0) as total_commission,
        coalesce(sum(s.vendor_due), 0) as total_vendor_due
      from public.sales s
      join public.products p on p.id = s.product_id
      join public.vendors v on v.id = p.vendor_id
      where s.deleted_at is null
        and p.deleted_at is null
      group by v.id, v.name
      order by total_sales desc
      `
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load sales by vendor'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
