import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

import { parseQueryDateRange, intakesDateFilter } from '@/lib/api/query-date-range'

export async function GET(req: Request) {
  try {
    await requireAdminSession()
    const url = new URL(req.url)
    const limitRaw = url.searchParams.get('limit')
    const limit = Math.max(1, Math.min(100, limitRaw ? Number(limitRaw) : 5))
    const { from, to } = parseQueryDateRange(url)

    const pool = getDbPool()
    const params: unknown[] = [limit]
    let dateFilter = ''
    if (from && to) {
      params.unshift(from, to)
      dateFilter = intakesDateFilter('i', 1, 2)
    }

    const { rows } = await pool.query(
      `
      select
        i.vendor_id,
        v.name as vendor_name,
        round(coalesce(sum(i.quantity_received * p.vendor_price), 0)::numeric, 2) as total_intake_value,
        coalesce(sum(i.quantity_received), 0)::int as total_quantity_received,
        count(*)::int as intake_events,
        count(distinct i.received_date)::int as receiving_days,
        count(distinct i.product_id)::int as distinct_products
      from public.intakes i
      join public.products p on p.id = i.product_id and p.deleted_at is null
      join public.vendors v on v.id = i.vendor_id and v.deleted_at is null
      where i.deleted_at is null
        ${dateFilter}
      group by i.vendor_id, v.name
      order by total_intake_value desc, receiving_days desc, total_quantity_received desc
      limit $${params.length}
      `,
      params
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load top vendors by intake'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
