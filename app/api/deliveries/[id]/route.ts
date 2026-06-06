import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

const RUN_SELECT = `
  dr.*,
  json_build_object('id', sm.id, 'name', sm.name, 'location', sm.location, 'branch', sm.branch, 'store_code', sm.store_code) as supermarket,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'id', dri.id,
          'product_id', dri.product_id,
          'quantity_delivered', dri.quantity_delivered,
          'created_at', dri.created_at,
          'product', json_build_object('id', p.id, 'name', p.name, 'vendor_id', p.vendor_id)
        )
      )
      from public.delivery_run_items dri
      join public.products p on p.id = dri.product_id
      where dri.delivery_run_id = dr.id
    ),
    '[]'::json
  ) as items
`

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
