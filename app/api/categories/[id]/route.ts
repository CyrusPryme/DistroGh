import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireSession()
  const { id } = await ctx.params
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select id, name, sort_order, created_at, updated_at
    from public.categories
    where id = $1::uuid
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
  const name = (body?.name ?? '').toString().trim()

  if (!name || name.length > 100) {
    return NextResponse.json({ success: false, error: 'Category name must be 1–100 characters' }, { status: 400 })
  }

  const pool = getDbPool()
  try {
    const prev = await pool.query(`select name from public.categories where id = $1::uuid limit 1`, [id])
    const prevName: string | null = (prev.rows[0]?.name ?? null) as any
    if (!prevName) return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 })

    const { rows } = await pool.query(
      `
      update public.categories
      set name = $1, updated_at = now()
      where id = $2::uuid
      returning id, name, sort_order, created_at, updated_at
      `,
      [name, id]
    )

    if (prevName !== name) {
      await pool.query(
        `
        update public.products
        set category = $1, updated_at = now()
        where category = $2
        `,
        [name, prevName]
      )
    }

    return NextResponse.json({ success: true, data: rows[0] })
  } catch (e: any) {
    if (e?.code === '23505') {
      return NextResponse.json({ success: false, error: 'A category with this name already exists' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: e?.message ?? 'Failed to update category' }, { status: 500 })
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const pool = getDbPool()

  const prev = await pool.query(`select name from public.categories where id = $1::uuid limit 1`, [id])
  const prevName: string | null = (prev.rows[0]?.name ?? null) as any
  if (!prevName) return NextResponse.json({ success: false, error: 'Category not found' }, { status: 404 })

  await pool.query(
    `
    update public.products
    set category = null, updated_at = now()
    where category = $1
    `,
    [prevName]
  )

  await pool.query(`delete from public.categories where id = $1::uuid`, [id])
  return NextResponse.json({ success: true })
}

