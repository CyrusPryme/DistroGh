import type { PoolClient } from 'pg'

/**
 * Historical migrated deliveries are already completed business events — mark them
 * confirmed and push quantities into supermarket_inventory without transport charges.
 */
export async function confirmHistoricalDeliveryRun(
  client: PoolClient,
  params: {
    deliveryRunId: string
    supermarketId: string
    confirmedBy?: string | null
  }
): Promise<void> {
  const { rows: items } = await client.query(
    `SELECT product_id, quantity_delivered FROM public.delivery_run_items WHERE delivery_run_id = $1::uuid`,
    [params.deliveryRunId]
  )
  if (!items.length) return

  for (const item of items) {
    const qty = Number(item.quantity_delivered) || 0
    if (qty <= 0) continue
    const { rows: existing } = await client.query(
      `SELECT id FROM public.supermarket_inventory
       WHERE supermarket_id = $1::uuid AND product_id = $2::uuid
       FOR UPDATE`,
      [params.supermarketId, item.product_id]
    )
    if (existing[0]) {
      await client.query(
        `UPDATE public.supermarket_inventory SET quantity = quantity + $2, updated_at = now() WHERE id = $1::uuid`,
        [existing[0].id, qty]
      )
    } else {
      await client.query(
        `INSERT INTO public.supermarket_inventory (supermarket_id, product_id, quantity)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [params.supermarketId, item.product_id, qty]
      )
    }
  }

  await client.query(
    `UPDATE public.delivery_runs
     SET confirmed_at = COALESCE(confirmed_at, now()),
         confirmed_by = COALESCE(confirmed_by, $2::uuid)
     WHERE id = $1::uuid`,
    [params.deliveryRunId, params.confirmedBy ?? null]
  )
}
