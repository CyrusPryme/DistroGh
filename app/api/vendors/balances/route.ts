import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function GET() {
  try {
    await requireAdminSession()
    const pool = getDbPool()
    let rows: Record<string, unknown>[]
    try {
      const result = await pool.query(
        `
        select
          vendor_id,
          vendor_name,
          momo_number,
          momo_network,
          total_due,
          total_paid,
          balance
        from reporting.vendor_balances
        order by balance desc, vendor_name asc
        `
      )
      rows = result.rows
    } catch {
      const result = await pool.query(
        `
        with sales_totals as (
          select pr.vendor_id, sum(coalesce(s.vendor_due, 0)) as total_due
          from public.sales s
          join public.products pr on pr.id = s.product_id
          where s.deleted_at is null and pr.deleted_at is null
          group by pr.vendor_id
        ),
        returns_totals as (
          select pr.vendor_id,
            sum(coalesce(r.quantity_returned, 0) * coalesce(pr.vendor_price, 0)) as returns_deduct
          from public.product_returns r
          join public.products pr on pr.id = r.product_id
          where r.deleted_at is null and pr.deleted_at is null
          group by pr.vendor_id
        ),
        deductions_totals as (
          select vendor_id, sum(coalesce(amount, 0)) as total_deductions
          from public.vendor_deductions
          group by vendor_id
        ),
        paid_totals as (
          select vendor_id, sum(coalesce(amount_paid, 0)) as total_paid
          from public.payouts
          where deleted_at is null and status = 'completed'
          group by vendor_id
        )
        select
          v.id as vendor_id,
          v.name as vendor_name,
          v.momo_number,
          v.momo_network,
          coalesce(st.total_due, 0) as total_due,
          coalesce(pt.total_paid, 0) as total_paid,
          (coalesce(st.total_due, 0) - coalesce(rt.returns_deduct, 0)
            - coalesce(dt.total_deductions, 0) - coalesce(pt.total_paid, 0)) as balance
        from public.vendors v
        left join sales_totals st on st.vendor_id = v.id
        left join returns_totals rt on rt.vendor_id = v.id
        left join deductions_totals dt on dt.vendor_id = v.id
        left join paid_totals pt on pt.vendor_id = v.id
        where v.deleted_at is null
        order by balance desc, vendor_name asc
        `
      )
      rows = result.rows
    }
    return NextResponse.json({ success: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load vendor balances'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
