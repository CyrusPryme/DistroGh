import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

import { parseQueryDateRange, salesWeekStartFilter } from '@/lib/api/query-date-range'
import { sqlEffectiveDistroMarkup } from '@/lib/sale-amounts'

function normalizeUuidParam(v: string | null) {
  const s = (v ?? '').toString().trim()
  return s ? s : null
}

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)

  const limitRaw = url.searchParams.get('limit')
  const limit = Math.max(1, Math.min(200, limitRaw ? Number(limitRaw) : 12))

  const vendorIdParam = normalizeUuidParam(url.searchParams.get('vendorId') ?? url.searchParams.get('vendor_id'))
  const vendor_id = session.role === 'vendor' ? (session.vendor_id ?? null) : vendorIdParam

  const pool = getDbPool()
  const { from, to } = parseQueryDateRange(url)
  // Vendor portal must not see DistroGH catalog markup; admin totals use product.distrogh_markup.
  const markupSum =
    session.role === 'vendor'
      ? 'coalesce(sum(s.commission_amount), 0)'
      : `coalesce(sum(${sqlEffectiveDistroMarkup('s', 'p')}), 0)`

  if (vendor_id) {
    const params: unknown[] = [vendor_id, limit]
    let dateFilter = ''
    if (from && to) {
      params.splice(1, 0, from, to)
      dateFilter = salesWeekStartFilter('s', 2, 3)
    }
    const { rows } = await pool.query(
      `
      select
        date_trunc('month', s.week_start::timestamp)::date as week_start,
        (date_trunc('month', s.week_start::timestamp) + interval '1 month' - interval '1 day')::date as week_end,
        coalesce(sum(s.total_sales), 0) as total_sales,
        ${markupSum} as total_commission,
        coalesce(sum(s.vendor_due), 0) as total_vendor_due
      from public.sales s
      join public.products p on p.id = s.product_id
      where s.deleted_at is null
        and p.deleted_at is null
        and p.vendor_id = $1::uuid
        ${dateFilter}
      group by date_trunc('month', s.week_start::timestamp)
      order by week_start desc
      limit $${params.length}
      `,
      params
    )
    return NextResponse.json({ success: true, data: rows })
  }

  const dateParams: unknown[] = []
  let dateFilter = ''
  if (from && to) {
    dateParams.push(from, to)
    dateFilter = salesWeekStartFilter('s', 1, 2)
  }
  dateParams.push(limit)

  const { rows } = await pool.query(
    `
    select
      date_trunc('month', s.week_start::timestamp)::date as week_start,
      (date_trunc('month', s.week_start::timestamp) + interval '1 month' - interval '1 day')::date as week_end,
      coalesce(sum(s.total_sales), 0) as total_sales,
      ${markupSum} as total_commission,
      coalesce(sum(s.vendor_due), 0) as total_vendor_due
    from public.sales s
    join public.products p on p.id = s.product_id
    where s.deleted_at is null
      ${dateFilter}
    group by date_trunc('month', s.week_start::timestamp)
    order by week_start desc
    limit $${dateParams.length}
    `,
    dateParams
  )
  return NextResponse.json({ success: true, data: rows })
}

