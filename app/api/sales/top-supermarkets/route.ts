import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  try {
    await requireAdminSession()
    const url = new URL(req.url)
    const limitRaw = url.searchParams.get('limit')
    const limit = Math.max(1, Math.min(100, limitRaw ? Number(limitRaw) : 5))

    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select
        s.supermarket_id,
        sm.name as supermarket_name,
        coalesce(sum(s.qty_sold), 0)::int as total_qty,
        coalesce(sum(s.total_sales), 0) as total_sales
      from public.sales s
      join public.supermarkets sm on sm.id = s.supermarket_id
      where s.deleted_at is null
        and sm.deleted_at is null
      group by s.supermarket_id, sm.name
      order by total_sales desc
      limit $1
      `,
      [limit]
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load top supermarkets'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
