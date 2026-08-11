import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { DELIVERY_RUN_LIST_SELECT, DELIVERY_RUN_SELECT } from '@/lib/delivery-run-sql'
import { assertSufficientStockForDelivery } from '@/lib/delivery-stock'
import { validateLiveTransportCost } from '@/lib/migration/transport-cost'

const RUN_SELECT = DELIVERY_RUN_LIST_SELECT

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
        left join public.supermarkets sm on sm.id = dr.supermarket_id
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
        limit 20000
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
      left join public.supermarkets sm on sm.id = dr.supermarket_id
      where dr.deleted_at is null
        and ($1::uuid is null or dr.supermarket_id = $1::uuid)
        and ($2::date is null or dr.delivery_date >= $2::date)
        and ($3::date is null or dr.delivery_date <= $3::date)
        and ($4::boolean is false or dr.confirmed_at is not null)
      order by dr.delivery_date desc
      limit 20000
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
    const notes = body?.notes?.trim() || null
    const items = Array.isArray(body?.items) ? body.items : []

    if (!supermarket_id) {
      return NextResponse.json({ success: false, error: 'supermarket_id is required' }, { status: 400 })
    }

          // LIVE deliveries always require a transport cost — historical migration is the only
          // context where this may be NULL. Reject null/empty/undefined/non-numeric explicitly
          // rather than silently defaulting to 0 (0 is a valid recorded cost; "not provided" is not).
          const transportCostCheck = validateLiveTransportCost(body?.total_transport_cost)
          if (!transportCostCheck.ok) {
            return NextResponse.json({ success: false, error: transportCostCheck.error }, { status: 400 })
          }
          const total_transport_cost = transportCostCheck.value

    const validItems = items
      .map((i: any) => ({
        product_id: (i?.product_id ?? '').toString().trim(),
        quantity_delivered: Number(i?.quantity_delivered ?? 0),
      }))
      .filter((i: { product_id: string; quantity_delivered: number }) => i.product_id && i.quantity_delivered > 0)

    // The UI already guards this, but the API must too: creating a delivery run with zero
    // real line items would "succeed" while moving no stock at all — a silent no-op dressed up
    // as a real delivery record.
    if (validItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one product with a quantity greater than 0 is required' },
        { status: 400 }
      )
    }

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('begin')

      const { rows: runRows } = await client.query(
        `
        insert into public.delivery_runs
          (supermarket_id, delivery_date, total_transport_cost, notes, source, destination_type)
        values ($1::uuid, $2::date, $3, $4, 'LIVE_OPERATION', 'BRANCH')
        returning *
        `,
        [supermarket_id, delivery_date, total_transport_cost, notes]
      )
      const run = runRows[0]
      if (!run) throw new Error('Failed to create delivery run')

      await assertSufficientStockForDelivery(client, validItems)

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
        `select ${DELIVERY_RUN_SELECT} from public.delivery_runs dr left join public.supermarkets sm on sm.id = dr.supermarket_id where dr.id = $1`,
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
