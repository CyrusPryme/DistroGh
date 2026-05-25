import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireVendorSelfOrAdmin } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { enforceVendorServiceCharge } from '@/lib/vendor-service-charge-enforce'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    await requireVendorSelfOrAdmin(id)
    const pool = getDbPool()
    await enforceVendorServiceCharge(pool, id)
    const { rows } = await pool.query(
      `select * from public.vendors where id = $1::uuid and deleted_at is null limit 1`,
      [id]
    )
    if (!rows[0]) return NextResponse.json({ success: true, data: null })
    return NextResponse.json({ success: true, data: rows[0] })
  } catch (e) {
    return apiError(e, 'Failed to load vendor')
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  const pool = getDbPool()

  const fields: string[] = []
  const values: unknown[] = []
  let i = 1
  for (const key of [
    'name',
    'momo_number',
    'momo_network',
    'default_commission',
    'status',
    'login_email',
    'contact_phone',
    'description',
    'verification_feedback',
  ] as const) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) {
      fields.push(`${key} = $${i++}`)
      values.push(body[key])
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
  }

  values.push(id)
  const { rows } = await pool.query(
    `
    update public.vendors
    set ${fields.join(', ')}, updated_at = now()
    where id = $${i}::uuid and deleted_at is null
    returning *
    `,
    values
  )
  if (!rows[0]) return NextResponse.json({ success: false, error: 'Vendor not found.' }, { status: 404 })
  return NextResponse.json({ success: true, data: rows[0] })
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const pool = getDbPool()
  const { rows } = await pool.query(
    `update public.vendors set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null returning id`,
    [id]
  )
  if (!rows[0]) return NextResponse.json({ success: false, error: 'Vendor not found.' }, { status: 404 })
  return NextResponse.json({ success: true })
}
