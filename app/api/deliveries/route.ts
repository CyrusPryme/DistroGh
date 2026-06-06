import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'
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

export async function GET(req: Request) {
  try {
    const session = await requireSession()
    const url = new URL(req.url)
    const supermarket_id = (url.searchParams.get('supermarket_id') ?? '').trim() || null
    const from = (url.searchParams.get('from') ?? '').trim() || null
    const to = (url.searchParams.get('to') ?? '').trim() || null
    const vendor_id_param = (url.searchParams.get('vendor_id') ?? '').trim() || null
    const confirmed_only = url.searchParams.get('confirmed') === '1'

    const vendor_id =
      session.role === 'vendor' ? (session.vendor_id ?? null) : vendor_id_param

    const pool = getDbPool()

    if (vendor_id) {
      const { rows } = await pool.query(
        `
        select ${RUN_SELECT}
        from public.delivery_runs dr
        join public.supermarkets sm on sm.id = dr.supermarket_id
        where dr.deleted_at is null
          and dr.confirmed_at is not null
          and exists (
            select 1
            from public.delivery_run_items dri
            join public.products p on p.id = dri.product_id
            where dri.delivery_run_id = dr.id
              and p.vendor_id = $1::uuid
          )
          and ($2::uuid is null or dr.supermarket_id = $2::uuid)
          and ($3::date is null or dr.delivery_date >= $3::date)
          and ($4::date is null or dr.delivery_date <= $4::date)
        order by dr.delivery_date desc
        `,
        [vendor_id, supermarket_id, from, to]
      )
      return NextResponse.json({ success: true, data: rows })
    }

    if (session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { rows } = await pool.query(
      `
      select ${RUN_SELECT}
      from public.delivery_runs dr
      join public.supermarkets sm on sm.id = dr.supermarket_id
      where dr.deleted_at is null
        and ($1::uuid is null or dr.supermarket_id = $1::uuid)
        and ($2::date is null or dr.delivery_date >= $2::date)
        and ($3::date is null or dr.delivery_date <= $3::date)
        and ($4::boolean is false or dr.confirmed_at is not null)
      order by dr.delivery_date desc
      `,
      [supermarket_id, from, to, confirmed_only]
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    return apiError(e, 'Failed to load deliveries')
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminSession()
    const body = await req.json().catch(() => null)
    const supermarket_id = (body?.supermarket_id ?? '').toString().trim()
    const delivery_date = (body?.delivery_date ?? new Date().toISOString().slice(0, 10)).toString()
    const total_transport_cost = Number(body?.total_transport_cost ?? 0)
    const notes = body?.notes?.trim() || null
    const items = Array.isArray(body?.items) ? body.items : []

    if (!supermarket_id) {
      return NextResponse.json({ success: false, error: 'supermarket_id is required' }, { status: 400 })
    }

    const validItems = items
      .map((i: any) => ({
        product_id: (i?.product_id ?? '').toString().trim(),
        quantity_delivered: Number(i?.quantity_delivered ?? 0),
      }))
      .filter((i: { product_id: string; quantity_delivered: number }) => i.product_id && i.quantity_delivered > 0)

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')

      const { rows: runRows } = await client.query(
        `
        insert into public.delivery_runs (supermarket_id, delivery_date, total_transport_cost, notes)
        values ($1::uuid, $2::date, $3, $4)
        returning *
        `,
        [supermarket_id, delivery_date, total_transport_cost, notes]
      )
      const run = runRows[0]
      if (!run) throw new Error('Failed to create delivery run')

      for (const item of validItems) {
        await client.query(
          `
          insert into public.delivery_run_items (delivery_run_id, product_id, quantity_delivered)
          values ($1::uuid, $2::uuid, $3)
          on conflict (delivery_run_id, product_id) do update
          set quantity_delivered = public.delivery_run_items.quantity_delivered + excluded.quantity_delivered
          `,
          [run.id, item.product_id, item.quantity_delivered]
        )
      }

      await client.query('commit')

      const { rows } = await pool.query(
        `select ${RUN_SELECT} from public.delivery_runs dr join public.supermarkets sm on sm.id = dr.supermarket_id where dr.id = $1`,
        [run.id]
      )
      return NextResponse.json({ success: true, data: rows[0] ?? run }, { status: 201 })
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    return apiError(e, 'Failed to create delivery')
  }
}
