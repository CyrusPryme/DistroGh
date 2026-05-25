import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * Returns the same shape used by `services/supermarket.service.ts` getSummaries():
 * SupermarketSummary[] = Supermarket & { total_sales, sales_count, return_count, delivery_run_count }
 */
export async function GET() {
  try {
    await requireSession()
    const pool = getDbPool()

    const { rows } = await pool.query(
      `
      select
        s.*,
        coalesce(sa.total_sales, 0) as total_sales,
        coalesce(sa.sales_count, 0) as sales_count,
        coalesce(pr.return_count, 0) as return_count,
        coalesce(dr.delivery_run_count, 0) as delivery_run_count
      from public.supermarkets s
      left join (
        select supermarket_id, sum(total_sales)::numeric as total_sales, count(*)::int as sales_count
        from public.sales
        where deleted_at is null
        group by supermarket_id
      ) sa on sa.supermarket_id = s.id
      left join (
        select supermarket_id, count(*)::int as return_count
        from public.product_returns
        where deleted_at is null
        group by supermarket_id
      ) pr on pr.supermarket_id = s.id
      left join (
        select supermarket_id, count(*)::int as delivery_run_count
        from public.delivery_runs
        where deleted_at is null
        group by supermarket_id
      ) dr on dr.supermarket_id = s.id
      where s.deleted_at is null
      order by s.name asc
      `
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (err) {
    return errorResponse(err)
  }
}

