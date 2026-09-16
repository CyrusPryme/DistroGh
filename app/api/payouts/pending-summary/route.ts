import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requirePermission } from '@/lib/auth/require'
import { allVendorsBalanceFallbackSql } from '@/lib/vendor-balance-sql'

export async function GET() {
  try {
    await requirePermission('payouts', 'read')
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
            and status in ('pending', 'processing')
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
          with vendor_rows as (
            ${allVendorsBalanceFallbackSql()}
          )
          select
            count(*)::int as count,
            coalesce(sum(greatest(balance, 0)), 0) as total_balance
          from vendor_rows
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
