import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { applyDeliveryVendorCharges } from '@/lib/delivery-charges'
import { DELIVERY_RUN_SELECT } from '@/lib/delivery-run-sql'
import { toSqlDate } from '@/lib/utils'
import type { DeliveryAllocationLine } from '@/lib/delivery-cost-allocation'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

const RUN_SELECT = DELIVERY_RUN_SELECT

function parseCustomAllocation(body: unknown): DeliveryAllocationLine[] | undefined {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { vendor_charges?: unknown }).vendor_charges)) {
    return undefined
  }
  const rows = (body as { vendor_charges: unknown[] }).vendor_charges
  if (rows.length === 0) return undefined
  return rows.map((row) => {
    const r = row as Record<string, unknown>
    return {
      vendor_id: String(r.vendor_id ?? ''),
      vendor_name: r.vendor_name != null ? String(r.vendor_name) : undefined,
      quantity_delivered: Number(r.quantity_delivered) || 0,
      share_percent: Number(r.share_percent) || 0,
      allocated_amount: Number(r.allocated_amount) || 0,
    }
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession()
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const customAllocation = parseCustomAllocation(body)
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('begin')

      const { rows: runRows } = await client.query(
        `
        select dr.*, sm.name as supermarket_name, coalesce(sm.branch, '') as supermarket_branch
        from public.delivery_runs dr
        join public.supermarkets sm on sm.id = dr.supermarket_id
        where dr.id = $1::uuid and dr.deleted_at is null
        for update
        `,
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

      const totalTransportCost =
        body && typeof body === 'object' && (body as { total_transport_cost?: unknown }).total_transport_cost != null
          ? Math.max(0, Number((body as { total_transport_cost: unknown }).total_transport_cost) || 0)
          : Math.max(0, Number(run.total_transport_cost ?? 0) || 0)

      await client.query(
        `
        update public.delivery_runs
        set total_transport_cost = $2, confirmed_at = now(), confirmed_by = $3::uuid
        where id = $1::uuid
        `,
        [id, totalTransportCost, session.user_id]
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

      const branch = String(run.supermarket_branch ?? '').trim()
      const supermarketLabel = branch
        ? `${String(run.supermarket_name)} — ${branch}`
        : String(run.supermarket_name ?? '')

      const vendorCharges = await applyDeliveryVendorCharges(client, {
        deliveryRunId: id,
        totalTransportCost,
        deliveryDate: toSqlDate(run.delivery_date),
        supermarketLabel,
        createdByUserId: session.user_id,
        customAllocation,
      })

      await client.query('commit')

      const { rows } = await pool.query(
        `select ${RUN_SELECT} from public.delivery_runs dr join public.supermarkets sm on sm.id = dr.supermarket_id where dr.id = $1`,
        [id]
      )

      await writeAuditLog(pool, {
        ...actorFromSession(session),
        action: 'delivery_confirmed',
        module: 'deliveries',
        target_id: id,
        metadata: { total_transport_cost: totalTransportCost, vendor_charges_count: vendorCharges.length },
        ip_address: ipFromRequest(req),
      })

      return NextResponse.json({
        success: true,
        data: rows[0],
        vendor_charges: vendorCharges,
      })
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
