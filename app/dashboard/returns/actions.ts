'use server'

import { getDbPool } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require'
import type { CreateReturnPayload } from '@/services/returns.service'
import type { ProductReturn } from '@/types'

export async function createReturnAdmin(
  payload: CreateReturnPayload
): Promise<{ return: ProductReturn } | { error: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Only admins can record returns. Returns are reported by supermarkets.' }
  }

  if (!payload.product_id || !payload.supermarket_id) {
    return { error: 'Product and supermarket are required' }
  }
  if (payload.quantity_returned < 1) return { error: 'Quantity must be at least 1' }
  if (payload.unit_price < 0) return { error: 'Unit price cannot be negative' }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows } = await client.query(
      `
      insert into public.product_returns (
        product_id, supermarket_id, quantity_returned, unit_price, reason, reason_notes, return_date
      )
      values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date)
      returning *
      `,
      [
        payload.product_id,
        payload.supermarket_id,
        payload.quantity_returned,
        payload.unit_price,
        payload.reason,
        payload.reason_notes?.trim() || null,
        payload.return_date || new Date().toISOString().slice(0, 10),
      ]
    )

    const inv = await client.query(
      `
      select id, quantity from public.supermarket_inventory
      where supermarket_id = $1::uuid and product_id = $2::uuid
      for update
      `,
      [payload.supermarket_id, payload.product_id]
    )
    if (inv.rows[0]) {
      const newQty = Math.max(0, Number(inv.rows[0].quantity ?? 0) - payload.quantity_returned)
      await client.query(
        `update public.supermarket_inventory set quantity = $2, updated_at = now() where id = $1::uuid`,
        [inv.rows[0].id, newQty]
      )
    }

    await client.query('commit')

    const detail = await pool.query(
      `
      select
        r.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'vendor_id', p.vendor_id,
          'vendor_price', p.vendor_price, 'distrogh_markup', p.distrogh_markup,
          'vendor', json_build_object('id', v.id, 'name', v.name)
        ) as product,
        json_build_object('id', sm.id, 'name', sm.name, 'location', sm.location) as supermarket
      from public.product_returns r
      join public.products p on p.id = r.product_id
      left join public.vendors v on v.id = p.vendor_id
      join public.supermarkets sm on sm.id = r.supermarket_id
      where r.id = $1::uuid
      `,
      [rows[0].id]
    )
    return { return: detail.rows[0] as ProductReturn }
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}
