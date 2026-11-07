import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'

export async function GET() {
  await requireSession()
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select id, name, sort_order, created_at, updated_at
    from public.categories
    order by sort_order asc, name asc
    `
  )
  return NextResponse.json({ success: true, data: rows })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)
  const name = (body?.name ?? '').toString().trim()

  if (!name || name.length > 100) {
    return NextResponse.json({ success: false, error: 'Category name must be 1–100 characters' }, { status: 400 })
  }

  const pool = getDbPool()
  try {
    const { rows } = await pool.query(
      `
      insert into public.categories (name)
      values ($1)
      returning id, name, sort_order, created_at, updated_at
      `,
      [name]
    )
    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === '23505') {
      return NextResponse.json({ success: false, error: 'A category with this name already exists' }, { status: 409 })
    }
    const message = e instanceof Error ? e.message : 'Failed to create category'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

