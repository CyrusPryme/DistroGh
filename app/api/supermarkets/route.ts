import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500
  return NextResponse.json({ success: false, error: message }, { status })
}

export async function GET() {
  try {
    await requireSession()
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select * from public.supermarkets
      where deleted_at is null
      order by name asc, coalesce(branch, '') asc
      `
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminSession()
    const body = await req.json().catch(() => null)
    const name = (body?.name ?? '').toString().trim()
    const location = (body?.location ?? '').toString().trim()
    const branch = (body?.branch ?? '').toString().trim() || null
    const store_code = (body?.store_code ?? '').toString().trim() || null

    if (!name) {
      return NextResponse.json({ success: false, error: 'Supermarket name is required' }, { status: 400 })
    }
    if (!location) {
      return NextResponse.json({ success: false, error: 'Supermarket location is required' }, { status: 400 })
    }

    const pool = getDbPool()
    const byNameBranch = await pool.query(
      `
      select id from public.supermarkets
      where deleted_at is null
        and lower(name) = lower($1)
        and lower(coalesce(branch, '')) = lower(coalesce($2::text, ''))
      limit 1
      `,
      [name, branch]
    )
    if (byNameBranch.rowCount) {
      return NextResponse.json(
        { success: false, error: branch ? 'A supermarket with this name and branch already exists.' : 'A supermarket with this name already exists.' },
        { status: 409 }
      )
    }

    const { rows } = await pool.query(
      `
      insert into public.supermarkets (name, location, branch, store_code)
      values ($1, $2, $3, $4)
      returning *
      `,
      [name, location, branch, store_code]
    )
    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
