import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

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

  if (vendor_id) {
    const { rows } = await pool.query(
      `
      select
        date_trunc('month', s.week_start::timestamp)::date as week_start,
        (date_trunc('month', s.week_start::timestamp) + interval '1 month' - interval '1 day')::date as week_end,
        coalesce(sum(s.total_sales), 0) as total_sales,
        coalesce(sum(s.commission_amount), 0) as total_commission,
        coalesce(sum(s.vendor_due), 0) as total_vendor_due
      from public.sales s
      join public.products p on p.id = s.product_id
      where s.deleted_at is null
        and p.deleted_at is null
        and p.vendor_id = $1::uuid
      group by date_trunc('month', s.week_start::timestamp)
      order by week_start desc
      limit $2
      `,
      [vendor_id, limit]
    )
    return NextResponse.json({ success: true, data: rows })
  }

  // When not filtered by vendor, pull from the DB view directly.
  const { rows } = await pool.query(
    `
    select *
    from public.weekly_revenue
    order by week_start desc
    limit $1
    `,
    [limit]
  )

  return NextResponse.json({ success: true, data: rows })
}

