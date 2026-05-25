import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

function normalizeUuidParam(v: string | null) {
  const s = (v ?? '').toString().trim()
  return s ? s : null
}

export async function GET(req: Request) {
  try {
  const session = await requireSession()
  const url = new URL(req.url)

  const week_start = (url.searchParams.get('week_start') ?? '').trim() || null
  const week_end = (url.searchParams.get('week_end') ?? '').trim() || null
  const range_start = (url.searchParams.get('range_start') ?? '').trim() || null
  const range_end = (url.searchParams.get('range_end') ?? '').trim() || null
  const product_id = normalizeUuidParam(url.searchParams.get('product_id'))
  const supermarket_id = normalizeUuidParam(url.searchParams.get('supermarket_id'))

  const vendorIdParam = normalizeUuidParam(url.searchParams.get('vendor_id'))
  const vendor_id = session.role === 'vendor' ? (session.vendor_id ?? null) : vendorIdParam

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      s.*,
      json_build_object(
        'id', p.id,
        'name', p.name,
        'vendor_id', p.vendor_id,
        'vendor_price', p.vendor_price,
        'distrogh_markup', p.distrogh_markup,
        'selling_price', p.selling_price,
        'vendor', json_build_object(
          'id', v.id,
          'name', v.name,
          'momo_number', v.momo_number,
          'momo_network', v.momo_network,
          'default_commission', v.default_commission,
          'login_email', v.login_email
        )
      ) as product,
      json_build_object(
        'id', sm.id,
        'name', sm.name,
        'location', sm.location
      ) as supermarket
    from public.sales s
    join public.products p on p.id = s.product_id
    left join public.vendors v on v.id = p.vendor_id
    left join public.supermarkets sm on sm.id = s.supermarket_id
    where s.deleted_at is null
      and ($1::date is null or s.week_start >= $1::date)
      and ($2::date is null or s.week_end <= $2::date)
      and ($3::uuid is null or p.vendor_id = $3::uuid)
      and ($4::uuid is null or s.product_id = $4::uuid)
      and ($5::uuid is null or s.supermarket_id = $5::uuid)
      and ($6::date is null or s.week_start <= $6::date)
      and ($7::date is null or s.week_end >= $7::date)
    order by s.week_start asc, s.imported_at desc
    `,
    [week_start, week_end, vendor_id, product_id, supermarket_id, range_end, range_start]
  )

  return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    return apiError(e, 'Failed to load sales')
  }
}

