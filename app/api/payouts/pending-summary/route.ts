import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function GET() {
  try {
    await requireAdminSession()
    const pool = getDbPool()

    const [pendingPayouts, vendorBalances] = await Promise.all([
      pool.query(
        `
        with best_open as (
          select distinct on (vendor_id, week_start, week_end)
            vendor_id,
            week_start,
            week_end,
            greatest(amount_due - amount_paid, 0) as balance_remaining
          from public.payouts
          where deleted_at is null
            and status = 'pending'
            and amount_due > amount_paid
          order by vendor_id, week_start, week_end, amount_paid desc, created_at desc
        )
        select
          count(*)::int as count,
          coalesce(sum(balance_remaining), 0) as balance_remaining
        from best_open
        `
      ),
      pool.query(
        `
        select
          count(*)::int as count,
          coalesce(sum(greatest(balance, 0)), 0) as total_balance
        from reporting.vendor_balances
        where balance > 0
        `
      ).catch(async () =>
        pool.query(
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
            where deleted_at is null and status <> 'failed'
            group by vendor_id
          ),
          balances as (
            select
              (coalesce(st.total_due, 0) - coalesce(rt.returns_deduct, 0)
                - coalesce(dt.total_deductions, 0) - coalesce(pt.total_paid, 0)) as balance
            from public.vendors v
            left join sales_totals st on st.vendor_id = v.id
            left join returns_totals rt on rt.vendor_id = v.id
            left join deductions_totals dt on dt.vendor_id = v.id
            left join paid_totals pt on pt.vendor_id = v.id
            where v.deleted_at is null
          )
          select
            count(*)::int as count,
            coalesce(sum(greatest(balance, 0)), 0) as total_balance
          from balances
          where balance > 0
          `
        )
      ),
    ])

    const pendingRow = pendingPayouts.rows[0] ?? {}
    const balanceRow = vendorBalances.rows[0] ?? {}

    const pending_payout_count = Number(pendingRow.count ?? 0)
    const pending_payout_balance = Number(pendingRow.balance_remaining ?? 0)
    const vendor_balance_count = Number(balanceRow.count ?? 0)
    const vendor_balance_total = Number(balanceRow.total_balance ?? 0)

    return NextResponse.json({
      success: true,
      data: {
        pending_payout_count,
        pending_payout_balance,
        vendor_balance_count,
        vendor_balance_total,
        alert_count: pending_payout_count + vendor_balance_count,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load payout summary'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
