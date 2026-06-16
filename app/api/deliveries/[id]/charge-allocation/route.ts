import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { computeRunChargeAllocation, loadRunItemsWithVendors, mapChargeRows } from '@/lib/delivery-charges'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const pool = getDbPool()

    const { rows: runRows } = await pool.query(
      `
      select dr.total_transport_cost, dr.delivery_date, dr.confirmed_at,
        sm.name as supermarket_name,
        coalesce(sm.branch, '') as supermarket_branch
      from public.delivery_runs dr
      join public.supermarkets sm on sm.id = dr.supermarket_id
      where dr.id = $1::uuid and dr.deleted_at is null
      limit 1
      `,
      [id]
    )
    const run = runRows[0]
    if (!run) {
      return NextResponse.json({ success: false, error: 'Delivery run not found' }, { status: 404 })
    }

    const client = await pool.connect()
    try {
      const items = await loadRunItemsWithVendors(client, id)
      const allocation = computeRunChargeAllocation(Number(run.total_transport_cost ?? 0), items)

      let applied: typeof allocation = []
      if (run.confirmed_at) {
        const { rows } = await pool.query(
          `
          select c.vendor_id, v.name as vendor_name, c.quantity_delivered, c.share_percent, c.allocated_amount
          from public.delivery_run_vendor_charges c
          join public.vendors v on v.id = c.vendor_id
          where c.delivery_run_id = $1::uuid
          order by c.allocated_amount desc
          `,
          [id]
        )
        applied = mapChargeRows(rows)
      }

      const branch = String(run.supermarket_branch ?? '').trim()
      const supermarketLabel = branch
        ? `${String(run.supermarket_name)} — ${branch}`
        : String(run.supermarket_name ?? '')

      return NextResponse.json({
        success: true,
        data: {
          total_transport_cost: Number(run.total_transport_cost ?? 0),
          supermarket_label: supermarketLabel,
          delivery_date: String(run.delivery_date),
          confirmed: !!run.confirmed_at,
          preview: allocation,
          applied: applied.length > 0 ? applied : null,
        },
      })
    } finally {
      client.release()
    }
  } catch (e) {
    return apiError(e, 'Failed to load charge allocation')
  }
}
