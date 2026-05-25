import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)
  const vendorIdParam = url.searchParams.get('vendor_id')
  const vendorId = session.role === 'vendor' ? (session.vendor_id ?? null) : (vendorIdParam && vendorIdParam.trim() ? vendorIdParam : null)

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    with received as (
      select i.product_id, sum(i.quantity_received)::int as received
      from public.intakes i
      join public.products p on p.id = i.product_id
      where i.deleted_at is null
        and ($1::uuid is null or p.vendor_id = $1::uuid)
      group by i.product_id
    ),
    delivered as (
      select dri.product_id, sum(dri.quantity_delivered)::int as delivered
      from public.delivery_run_items dri
      join public.products p on p.id = dri.product_id
      join public.delivery_runs dr on dr.id = dri.delivery_run_id
      where dr.deleted_at is null
        and ($1::uuid is null or p.vendor_id = $1::uuid)
      group by dri.product_id
    )
    select
      p.id as product_id,
      p.name as product_name,
      coalesce(r.received, 0) as received,
      coalesce(d.delivered, 0) as delivered,
      greatest(0, coalesce(r.received, 0) - coalesce(d.delivered, 0)) as on_hand
    from public.products p
    left join received r on r.product_id = p.id
    left join delivered d on d.product_id = p.id
    where p.deleted_at is null
      and ($1::uuid is null or p.vendor_id = $1::uuid)
      and (coalesce(r.received, 0) > 0 or coalesce(d.delivered, 0) > 0)
    order by on_hand desc, product_name asc
    `,
    [vendorId]
  )

  return NextResponse.json({ success: true, data: rows })
}

