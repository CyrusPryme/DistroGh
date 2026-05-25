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
      p.*,
      json_build_object(
        'id', v.id,
        'name', v.name,
        'momo_number', v.momo_number,
        'momo_network', v.momo_network
      ) as vendor
    from public.payouts p
    join public.vendors v on v.id = p.vendor_id
    where p.id = $1::uuid and p.deleted_at is null
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

  if (body && Object.prototype.hasOwnProperty.call(body, 'status')) setField('status', String(body.status ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'amount_paid')) setField('amount_paid', Number(body.amount_paid ?? 0))
  if (body && Object.prototype.hasOwnProperty.call(body, 'momo_txn_id')) {
    const v = body.momo_txn_id != null && String(body.momo_txn_id).trim() ? String(body.momo_txn_id).trim() : null
    setField('momo_txn_id', v)
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'deleted_at')) {
    setField('deleted_at', body.deleted_at ? String(body.deleted_at) : null)
  }

  const status = body?.status != null ? String(body.status).trim() : null
  if (status === 'completed') setField('payout_date', new Date().toISOString())

  if (fields.length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
  }

  values.push(id)
  const pool = getDbPool()
  const updated = await pool.query(
    `
    update public.payouts
    set ${fields.join(', ')}, updated_at = now()
    where id = $${i}::uuid
    returning *
    `,
    values
  )

  const row = updated.rows[0]
  if (!row) return NextResponse.json({ success: false, error: 'Payout not found.' }, { status: 404 })

  const { rows } = await pool.query(
    `
    select
      p.*,
      json_build_object(
        'id', v.id,
        'name', v.name,
        'momo_number', v.momo_number,
        'momo_network', v.momo_network
      ) as vendor
    from public.payouts p
    join public.vendors v on v.id = p.vendor_id
    where p.id = $1::uuid
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
    `update public.payouts set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null returning id`,
    [id]
  )
  if (!rows[0]) return NextResponse.json({ success: false, error: 'Payout not found.' }, { status: 404 })
  return NextResponse.json({ success: true })
}

