import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { DELIVERY_RUN_SELECT } from '@/lib/delivery-run-sql'

const RUN_SELECT = DELIVERY_RUN_SELECT

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await ctx.params

    // A vendor session with no linked vendor_id must never fall through to an unscoped query.
    if (session.role === 'vendor' && !session.vendor_id) {
      return NextResponse.json({ success: true, data: null })
    }
    const vendorId = session.role === 'vendor' ? session.vendor_id : null

    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select ${RUN_SELECT}
      from public.delivery_runs dr
      left join public.supermarkets sm on sm.id = dr.supermarket_id
      where dr.id = $1::uuid and dr.deleted_at is null
        and (
          $2::uuid is null
          or (
            dr.confirmed_at is not null
            and exists (
              select 1
              from public.delivery_run_items dri
              join public.products p on p.id = dri.product_id
              where dri.delivery_run_id = dr.id
                and p.vendor_id = $2::uuid
            )
          )
        )
      limit 1
      `,
      [id, vendorId]
    )
    if (!rows[0]) return NextResponse.json({ success: true, data: null })
    return NextResponse.json({ success: true, data: rows[0] })
  } catch (e) {
    return apiError(e, 'Failed to load delivery')
  }
}
