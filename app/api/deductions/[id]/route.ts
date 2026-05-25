import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  if (session.role === 'vendor') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await ctx.params

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select d.*
    from public.vendor_deductions d
    where d.id = $1::uuid
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

  if (body && Object.prototype.hasOwnProperty.call(body, 'vendor_id')) setField('vendor_id', String(body.vendor_id ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'amount')) setField('amount', Number(body.amount ?? 0))
  if (body && Object.prototype.hasOwnProperty.call(body, 'reason')) setField('reason', String(body.reason ?? '').trim())
  if (body && Object.prototype.hasOwnProperty.call(body, 'deduction_date')) {
    const v = body.deduction_date && String(body.deduction_date).trim() ? String(body.deduction_date).trim() : null
    setField('deduction_date', v)
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'reference_id')) {
    const v = body.reference_id != null && String(body.reference_id).trim() ? String(body.reference_id).trim() : null
    setField('reference_id', v)
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'reference_type')) {
    const v = body.reference_type != null && String(body.reference_type).trim() ? String(body.reference_type).trim() : null
    setField('reference_type', v)
  }

  if (fields.length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
  }

  values.push(id)
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    update public.vendor_deductions
    set ${fields.join(', ')}
    where id = $${i}::uuid
    returning *
    `,
    values
  )

  if (!rows[0]) return NextResponse.json({ success: false, error: 'Deduction not found.' }, { status: 404 })
  return NextResponse.json({ success: true, data: rows[0] })
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const pool = getDbPool()
  await pool.query(`delete from public.vendor_deductions where id = $1::uuid`, [id])
  return NextResponse.json({ success: true })
}

