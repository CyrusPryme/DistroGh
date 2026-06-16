import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { DELIVERY_RUN_SELECT } from '@/lib/delivery-run-sql'

const RUN_SELECT = DELIVERY_RUN_SELECT

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select ${RUN_SELECT}
      from public.delivery_runs dr
      join public.supermarkets sm on sm.id = dr.supermarket_id
      where dr.id = $1::uuid and dr.deleted_at is null
      limit 1
      `,
      [id]
    )
    if (!rows[0]) return NextResponse.json({ success: true, data: null })
    return NextResponse.json({ success: true, data: rows[0] })
  } catch (e) {
    return apiError(e, 'Failed to load delivery')
  }
}
