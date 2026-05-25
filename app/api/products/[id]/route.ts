import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireSession()
  const { id } = await ctx.params
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      p.*,
      json_build_object(
        'id', v.id,
        'name', v.name,
        'momo_number', v.momo_number,
        'momo_network', v.momo_network,
        'default_commission', v.default_commission
      ) as vendor
    from public.products p
    left join public.vendors v on v.id = p.vendor_id
    where p.id = $1::uuid and p.deleted_at is null
    limit 1
    `,
    [id]
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

  if (body && Object.prototype.hasOwnProperty.call(body, 'name')) setField('name', String(body.name ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'vendor_id')) setField('vendor_id', String(body.vendor_id ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'vendor_price')) setField('vendor_price', Number(body.vendor_price ?? 0))
  if (body && Object.prototype.hasOwnProperty.call(body, 'distrogh_markup')) setField('distrogh_markup', Number(body.distrogh_markup ?? 0))
  if (body && Object.prototype.hasOwnProperty.call(body, 'expiry_date')) {
    const d = body.expiry_date && String(body.expiry_date).trim() ? String(body.expiry_date).trim() : null
    setField('expiry_date', d)
  }
  for (const k of ['sku', 'barcode', 'category', 'packaging_size'] as const) {
    if (body && Object.prototype.hasOwnProperty.call(body, k)) {
      const v = body[k] != null && String(body[k]).trim() ? String(body[k]).trim() : null
      setField(k, v)
    }
  }
  for (const k of ['wholesale_price', 'mall_retail_price'] as const) {
    if (body && Object.prototype.hasOwnProperty.call(body, k)) {
      const raw = body[k]
      const v = raw != null && raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : null
      setField(k, v)
    }
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'moq')) {
    const raw = body.moq
    const v = raw != null && raw !== '' && Number(raw) >= 1 ? Math.floor(Number(raw)) : 1
    setField('moq', v)
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'product_image_paths')) {
    setField('product_image_paths', Array.isArray(body.product_image_paths) ? body.product_image_paths : null)
  }

  if (fields.length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
  }

  // If pricing changed, update selling_price consistently.
  const pool = getDbPool()
  const current = await pool.query(
    `select vendor_price, distrogh_markup from public.products where id = $1::uuid and deleted_at is null`,
    [id]
  )
  if (!current.rows[0]) {
    return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 })
  }
  const curVp = Number(current.rows[0].vendor_price ?? 0)
  const curDm = Number(current.rows[0].distrogh_markup ?? 0)
  const nextVp = body && Object.prototype.hasOwnProperty.call(body, 'vendor_price') ? Number(body.vendor_price ?? 0) : curVp
  const nextDm = body && Object.prototype.hasOwnProperty.call(body, 'distrogh_markup') ? Number(body.distrogh_markup ?? 0) : curDm
  setField('selling_price', nextVp + nextDm)

  values.push(id)
  const { rows } = await pool.query(
    `
    update public.products
    set ${fields.join(', ')}, updated_at = now()
    where id = $${i}::uuid and deleted_at is null
    returning *
    `,
    values
  )
  return NextResponse.json({ success: true, data: rows[0] ?? null })
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const pool = getDbPool()
  const { rows } = await pool.query(
    `update public.products set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null returning id`,
    [id]
  )
  if (!rows[0]) return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 })
  return NextResponse.json({ success: true })
}

