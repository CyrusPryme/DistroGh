import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await ctx.params

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
    where r.id = $1::uuid and r.deleted_at is null
      and ($2::uuid is null or p.vendor_id = $2::uuid)
    limit 1
    `,
    [id, session.role === 'vendor' ? (session.vendor_id ?? null) : null]
  )

  return NextResponse.json({ success: true, data: rows[0] ?? null })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)

  const fields: string[] = []
  const values: any[] = []
  let i = 1

  function setField(key: string, value: any) {
    fields.push(`${key} = $${i++}`)
    values.push(value)
  }

  if (body && Object.prototype.hasOwnProperty.call(body, 'product_id')) setField('product_id', String(body.product_id ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'supermarket_id')) setField('supermarket_id', String(body.supermarket_id ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'quantity_returned')) setField('quantity_returned', Number(body.quantity_returned ?? 0))
  if (body && Object.prototype.hasOwnProperty.call(body, 'unit_price')) setField('unit_price', Number(body.unit_price ?? 0))
  if (body && Object.prototype.hasOwnProperty.call(body, 'reason')) setField('reason', String(body.reason ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'reason_notes')) {
    const v = body.reason_notes != null && String(body.reason_notes).trim() ? String(body.reason_notes).trim() : null
    setField('reason_notes', v)
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'return_date')) {
    const v = body.return_date && String(body.return_date).trim() ? String(body.return_date).trim() : null
    setField('return_date', v)
  }

  if (fields.length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
  }

  values.push(id)
  const pool = getDbPool()
  const updated = await pool.query(
    `
    update public.product_returns
    set ${fields.join(', ')}, updated_at = now()
    where id = $${i}::uuid and deleted_at is null
    returning *
    `,
    values
  )

  const row = updated.rows[0]
  if (!row) return NextResponse.json({ success: false, error: 'Return not found.' }, { status: 404 })

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

  return NextResponse.json({ success: true, data: rows[0] ?? null })
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const pool = getDbPool()
  const { rows } = await pool.query(
    `update public.product_returns set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null returning id`,
    [id]
  )
  if (!rows[0]) return NextResponse.json({ success: false, error: 'Return not found.' }, { status: 404 })
  return NextResponse.json({ success: true })
}

