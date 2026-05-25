import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)

  const product_id = url.searchParams.get('product_id')?.trim() || null
  const supermarket_id = url.searchParams.get('supermarket_id')?.trim() || null
  const from = url.searchParams.get('from')?.trim() || null
  const to = url.searchParams.get('to')?.trim() || null
  const vendorIdParam = url.searchParams.get('vendor_id')?.trim() || null

  const vendor_id =
    session.role === 'vendor' ? (session.vendor_id ?? null) : vendorIdParam

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      r.*,
      json_build_object(
        'id', p.id,
        'name', p.name,
        'vendor_id', p.vendor_id,
        'vendor_price', p.vendor_price,
        'distrogh_markup', p.distrogh_markup,
        'vendor', json_build_object('id', v.id, 'name', v.name)
      ) as product,
      json_build_object(
        'id', s.id,
        'name', s.name,
        'location', s.location
      ) as supermarket
    from public.product_returns r
    join public.products p on p.id = r.product_id
    join public.vendors v on v.id = p.vendor_id
    join public.supermarkets s on s.id = r.supermarket_id
    where r.deleted_at is null
      and ($1::uuid is null or r.product_id = $1::uuid)
      and ($2::uuid is null or r.supermarket_id = $2::uuid)
      and ($3::uuid is null or p.vendor_id = $3::uuid)
      and ($4::date is null or r.return_date >= $4::date)
      and ($5::date is null or r.return_date <= $5::date)
    order by r.return_date desc, r.created_at desc
    `,
    [product_id, supermarket_id, vendor_id, from, to]
  )

  return NextResponse.json({ success: true, data: rows })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)

  const product_id = (body?.product_id ?? '').toString().trim()
  const supermarket_id = (body?.supermarket_id ?? '').toString().trim()
  const quantity_returned = Number(body?.quantity_returned ?? 0)
  const unit_price = Number(body?.unit_price ?? 0)
  const reason = (body?.reason ?? '').toString().trim()
  const reason_notes = body?.reason_notes != null && String(body.reason_notes).trim() ? String(body.reason_notes).trim() : null
  const return_date = body?.return_date && String(body.return_date).trim()
    ? String(body.return_date).trim()
    : new Date().toISOString().slice(0, 10)

  if (!product_id) return NextResponse.json({ success: false, error: 'product_id is required' }, { status: 400 })
  if (!supermarket_id) return NextResponse.json({ success: false, error: 'supermarket_id is required' }, { status: 400 })
  if (Number.isNaN(quantity_returned) || quantity_returned <= 0) {
    return NextResponse.json({ success: false, error: 'quantity_returned must be greater than 0' }, { status: 400 })
  }
  if (Number.isNaN(unit_price) || unit_price < 0) {
    return NextResponse.json({ success: false, error: 'unit_price cannot be negative' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ success: false, error: 'reason is required' }, { status: 400 })

  const pool = getDbPool()
  const inserted = await pool.query(
    `
    insert into public.product_returns (
      product_id, supermarket_id, quantity_returned, unit_price, reason, reason_notes, return_date
    )
    values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date)
    returning *
    `,
    [product_id, supermarket_id, quantity_returned, unit_price, reason, reason_notes, return_date]
  )
  const row = inserted.rows[0]
  if (!row) return NextResponse.json({ success: false, error: 'Failed to create return' }, { status: 500 })

  const { rows } = await pool.query(
    `
    select
      r.*,
      json_build_object(
        'id', p.id,
        'name', p.name,
        'vendor_id', p.vendor_id,
        'vendor_price', p.vendor_price,
        'distrogh_markup', p.distrogh_markup,
        'vendor', json_build_object('id', v.id, 'name', v.name)
      ) as product,
      json_build_object(
        'id', s.id,
        'name', s.name,
        'location', s.location
      ) as supermarket
    from public.product_returns r
    join public.products p on p.id = r.product_id
    join public.vendors v on v.id = p.vendor_id
    join public.supermarkets s on s.id = r.supermarket_id
    where r.id = $1::uuid
    limit 1
    `,
    [row.id]
  )

  return NextResponse.json({ success: true, data: rows[0] ?? null }, { status: 201 })
}

