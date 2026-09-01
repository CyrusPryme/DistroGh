import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

import { parseQueryDateRange, salesWeekStartFilter } from '@/lib/api/query-date-range'

function normalizeUuidParam(v: string | null) {
  const s = (v ?? '').toString().trim()
  return s ? s : null
}

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)

  const limitRaw = url.searchParams.get('limit')
  const limit = Math.max(1, Math.min(200, limitRaw ? Number(limitRaw) : 10))

  const vendorIdParam = normalizeUuidParam(url.searchParams.get('vendorId') ?? url.searchParams.get('vendor_id'))
  const vendor_id = session.role === 'vendor' ? (session.vendor_id ?? null) : vendorIdParam

  const pool = getDbPool()
  const { from, to } = parseQueryDateRange(url)
  const params: unknown[] = [vendor_id, limit]
  let dateFilter = ''
  if (from && to) {
    params.splice(1, 0, from, to)
    dateFilter = salesWeekStartFilter('s', 2, 3)
  }

  const { rows } = await pool.query(
    `
    select
      s.*,
      json_build_object(
        'id', p.id,
        'name', p.name,
        'vendor_id', p.vendor_id,
        'vendor', json_build_object(
          'id', v.id,
          'name', v.name
        )
      ) as product,
      json_build_object(
        'id', sm.id,
        'name', sm.name
      ) as supermarket
    from public.sales s
    join public.products p on p.id = s.product_id
    left join public.vendors v on v.id = p.vendor_id
    left join public.supermarkets sm on sm.id = s.supermarket_id
    where s.deleted_at is null
      and ($1::uuid is null or p.vendor_id = $1::uuid)
      ${dateFilter}
    order by s.imported_at desc
    limit $${params.length}
    `,
    params
  )

  return NextResponse.json({ success: true, data: rows })
}

