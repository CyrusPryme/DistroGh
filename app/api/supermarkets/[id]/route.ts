import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500
  return NextResponse.json({ success: false, error: message }, { status })
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `select * from public.supermarkets where id = $1 and deleted_at is null limit 1`,
      [id]
    )
    return NextResponse.json({ success: true, data: rows[0] ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (body && Object.prototype.hasOwnProperty.call(body, 'name')) {
      const v = (body.name ?? '').toString().trim()
      if (!v) return NextResponse.json({ success: false, error: 'name cannot be empty.' }, { status: 400 })
      fields.push(`name = $${i++}`)
      values.push(v)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'location')) {
      const v = (body.location ?? '').toString().trim()
      if (!v) return NextResponse.json({ success: false, error: 'location cannot be empty.' }, { status: 400 })
      fields.push(`location = $${i++}`)
      values.push(v)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'branch')) {
      const v = (body.branch ?? '').toString().trim() || null
      fields.push(`branch = $${i++}`)
      values.push(v)
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'store_code')) {
      const v = (body.store_code ?? '').toString().trim() || null
      fields.push(`store_code = $${i++}`)
      values.push(v)
    }

    if (fields.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
    }

    const pool = getDbPool()
    values.push(id)
    const { rows } = await pool.query(
      `
      update public.supermarkets
      set ${fields.join(', ')}, updated_at = now()
      where id = $${i} and deleted_at is null
      returning *
      `,
      values
    )
    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Supermarket not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, data: rows[0] })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `update public.supermarkets set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null returning id`,
      [id]
    )
    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Supermarket not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
