import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export type SettlementBranch = {
  id: string
  branch: string | null
  location: string | null
}

export type SupermarketSettlementRow = {
  /** Chain/retailer name — settlement is tracked at this level, not per branch. */
  name: string
  branch_count: number
  branches: SettlementBranch[]
  total_billed: number
  total_settled: number
  total_outstanding: number
  settled_count: number
  unsettled_count: number
  oldest_unsettled_date: string | null
  oldest_unsettled_days: number
  aging_0_30: number
  aging_31_60: number
  aging_60_plus: number
}

/**
 * Accounts-receivable style rollup: how much each supermarket CHAIN has been
 * billed (total_sales), settled, and outstanding.
 *
 * Grouped by chain name, not individual branch/outlet — a chain settles with
 * DistroGH as one relationship (e.g. all Palace branches are paid together
 * via Palace Spintex), so per-branch "outstanding" figures would misleadingly
 * imply branches owe separately when they don't.
 *
 * Mirrors /api/vendors/balances (accounts payable) on the other side of the ledger.
 */
export async function GET() {
  try {
    await requireAdminSession()
    const pool = getDbPool()

    const { rows } = await pool.query<{
      name: string
      branch_count: number
      branches: SettlementBranch[]
      total_billed: string
      total_settled: string
      total_outstanding: string
      settled_count: number
      unsettled_count: number
      oldest_unsettled_date: string | null
      oldest_unsettled_days: number
      aging_0_30: string
      aging_31_60: string
      aging_60_plus: string
    }>(
      `
      with sale_rows as (
        select
          sm.name as chain_name,
          s.total_sales,
          s.supermarket_paid,
          s.week_end,
          greatest(0, (current_date - s.week_end))::int as days_outstanding
        from public.sales s
        join public.supermarkets sm on sm.id = s.supermarket_id and sm.deleted_at is null
        where s.deleted_at is null
      ),
      by_chain as (
        select
          chain_name,
          coalesce(sum(total_sales), 0) as total_billed,
          coalesce(sum(total_sales) filter (where supermarket_paid), 0) as total_settled,
          coalesce(sum(total_sales) filter (where not supermarket_paid), 0) as total_outstanding,
          count(*) filter (where supermarket_paid) as settled_count,
          count(*) filter (where not supermarket_paid) as unsettled_count,
          min(week_end) filter (where not supermarket_paid) as oldest_unsettled_date,
          coalesce(max(days_outstanding) filter (where not supermarket_paid), 0) as oldest_unsettled_days,
          coalesce(sum(total_sales) filter (where not supermarket_paid and days_outstanding <= 30), 0) as aging_0_30,
          coalesce(sum(total_sales) filter (where not supermarket_paid and days_outstanding > 30 and days_outstanding <= 60), 0) as aging_31_60,
          coalesce(sum(total_sales) filter (where not supermarket_paid and days_outstanding > 60), 0) as aging_60_plus
        from sale_rows
        group by chain_name
      ),
      chain_branches as (
        select
          sm.name as chain_name,
          count(*)::int as branch_count,
          json_agg(
            json_build_object('id', sm.id, 'branch', sm.branch, 'location', sm.location)
            order by coalesce(sm.branch, '')
          ) as branches
        from public.supermarkets sm
        where sm.deleted_at is null
        group by sm.name
      )
      select
        cb.chain_name as name,
        cb.branch_count,
        cb.branches,
        coalesce(bc.total_billed, 0)::numeric as total_billed,
        coalesce(bc.total_settled, 0)::numeric as total_settled,
        coalesce(bc.total_outstanding, 0)::numeric as total_outstanding,
        coalesce(bc.settled_count, 0)::int as settled_count,
        coalesce(bc.unsettled_count, 0)::int as unsettled_count,
        bc.oldest_unsettled_date::text as oldest_unsettled_date,
        coalesce(bc.oldest_unsettled_days, 0)::int as oldest_unsettled_days,
        coalesce(bc.aging_0_30, 0)::numeric as aging_0_30,
        coalesce(bc.aging_31_60, 0)::numeric as aging_31_60,
        coalesce(bc.aging_60_plus, 0)::numeric as aging_60_plus
      from chain_branches cb
      left join by_chain bc on bc.chain_name = cb.chain_name
      order by total_outstanding desc, cb.chain_name asc
      `
    )

    const byChain: SupermarketSettlementRow[] = rows.map((r) => ({
      name: r.name,
      branch_count: Number(r.branch_count),
      branches: r.branches ?? [],
      total_billed: Number(r.total_billed),
      total_settled: Number(r.total_settled),
      total_outstanding: Number(r.total_outstanding),
      settled_count: Number(r.settled_count),
      unsettled_count: Number(r.unsettled_count),
      oldest_unsettled_date: r.oldest_unsettled_date,
      oldest_unsettled_days: Number(r.oldest_unsettled_days),
      aging_0_30: Number(r.aging_0_30),
      aging_31_60: Number(r.aging_31_60),
      aging_60_plus: Number(r.aging_60_plus),
    }))

    const overall = byChain.reduce(
      (acc, r) => ({
        total_billed: acc.total_billed + r.total_billed,
        total_settled: acc.total_settled + r.total_settled,
        total_outstanding: acc.total_outstanding + r.total_outstanding,
        settled_count: acc.settled_count + r.settled_count,
        unsettled_count: acc.unsettled_count + r.unsettled_count,
        oldest_unsettled_days: Math.max(acc.oldest_unsettled_days, r.oldest_unsettled_days),
        aging_0_30: acc.aging_0_30 + r.aging_0_30,
        aging_31_60: acc.aging_31_60 + r.aging_31_60,
        aging_60_plus: acc.aging_60_plus + r.aging_60_plus,
      }),
      {
        total_billed: 0,
        total_settled: 0,
        total_outstanding: 0,
        settled_count: 0,
        unsettled_count: 0,
        oldest_unsettled_days: 0,
        aging_0_30: 0,
        aging_31_60: 0,
        aging_60_plus: 0,
      }
    )

    return NextResponse.json({ success: true, data: { overall, byChain } })
  } catch (e) {
    return apiError(e, 'Failed to load supermarket settlements')
  }
}
