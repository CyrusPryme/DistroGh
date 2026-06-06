import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
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

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('begin')

      const { rows: runRows } = await client.query(
        `select * from public.delivery_runs where id = $1::uuid and deleted_at is null for update`,
        [id]
      )
      const run = runRows[0]
      if (!run) {
        await client.query('rollback')
        return NextResponse.json({ success: false, error: 'Delivery run not found' }, { status: 404 })
      }
      if (run.confirmed_at) {
        await client.query('rollback')
        return NextResponse.json({ success: false, error: 'This delivery has already been confirmed' }, { status: 400 })
      }

      await client.query(
        `
        update public.delivery_runs
        set confirmed_at = now(), confirmed_by = $2::uuid
        where id = $1::uuid
        `,
        [id, session.user_id]
      )

      const { rows: items } = await client.query(
        `select product_id, quantity_delivered from public.delivery_run_items where delivery_run_id = $1::uuid`,
        [id]
      )

      for (const item of items) {
        const qty = Number(item.quantity_delivered) || 0
        const { rows: existing } = await client.query(
          `
          select id, quantity from public.supermarket_inventory
          where supermarket_id = $1::uuid and product_id = $2::uuid
          for update
          `,
          [run.supermarket_id, item.product_id]
        )
        if (existing[0]) {
          await client.query(
            `update public.supermarket_inventory set quantity = quantity + $2, updated_at = now() where id = $1::uuid`,
            [existing[0].id, qty]
          )
        } else {
          await client.query(
            `
            insert into public.supermarket_inventory (supermarket_id, product_id, quantity)
            values ($1::uuid, $2::uuid, $3)
            `,
            [run.supermarket_id, item.product_id, qty]
          )
        }
      }

      await client.query('commit')

      const { rows } = await pool.query(
        `select ${RUN_SELECT} from public.delivery_runs dr join public.supermarkets sm on sm.id = dr.supermarket_id where dr.id = $1`,
        [id]
      )
      return NextResponse.json({ success: true, data: rows[0] })
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    return apiError(e, 'Failed to confirm delivery')
  }
}
