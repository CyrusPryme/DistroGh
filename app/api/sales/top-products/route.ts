import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

function normalizeUuidParam(v: string | null) {
  const s = (v ?? '').toString().trim()
  return s ? s : null
}

export async function GET(req: Request) {
  try {
    const session = await requireSession()
    const url = new URL(req.url)
    const limitRaw = url.searchParams.get('limit')
    const limit = Math.max(1, Math.min(500, limitRaw ? Number(limitRaw) : 10))
    const sort = (url.searchParams.get('sort') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'

    const vendorIdParam = normalizeUuidParam(url.searchParams.get('vendorId') ?? url.searchParams.get('vendor_id'))
    const vendor_id = session.role === 'vendor' ? (session.vendor_id ?? null) : vendorIdParam

    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select
        s.product_id,
        p.name as product_name,
        v.name as vendor_name,
        coalesce(sum(s.qty_sold), 0)::int as total_qty,
        coalesce(sum(case when $1::uuid is not null then s.vendor_due else s.total_sales end), 0) as total_sales
      from public.sales s
      join public.products p on p.id = s.product_id
      left join public.vendors v on v.id = p.vendor_id
      where s.deleted_at is null
        and p.deleted_at is null
        and ($1::uuid is null or p.vendor_id = $1::uuid)
      group by s.product_id, p.name, v.name
      order by total_sales ${sort === 'asc' ? 'asc' : 'desc'}
      limit $2
      `,
      [vendor_id, limit]
    )

    return NextResponse.json({ success: true, data: rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load top products'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
