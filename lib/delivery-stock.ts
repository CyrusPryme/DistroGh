import type { PoolClient } from 'pg'

export type DeliveryStockLine = {
  product_id: string
  quantity_delivered: number
}

/** Ensure requested delivery quantities do not exceed stock on hand. */
export async function assertSufficientStockForDelivery(
  client: PoolClient,
  items: DeliveryStockLine[]
): Promise<void> {
  if (items.length === 0) return

  const requestedByProduct = new Map<string, number>()
  for (const item of items) {
    const productId = item.product_id?.trim()
    const qty = Math.max(0, Math.floor(Number(item.quantity_delivered) || 0))
    if (!productId || qty <= 0) continue
    requestedByProduct.set(productId, (requestedByProduct.get(productId) ?? 0) + qty)
  }

  const productIds = [...requestedByProduct.keys()]
  if (productIds.length === 0) return

  const { rows } = await client.query(
    `
    with received as (
      select i.product_id, sum(i.quantity_received)::int as qty
      from public.intakes i
      where i.deleted_at is null
        and i.product_id = any($1::uuid[])
      group by i.product_id
    ),
    delivered as (
      select dri.product_id, sum(dri.quantity_delivered)::int as qty
      from public.delivery_run_items dri
      join public.delivery_runs dr on dr.id = dri.delivery_run_id
      where dr.deleted_at is null
        and dri.product_id = any($1::uuid[])
      group by dri.product_id
    )
    select
      p.id as product_id,
      p.name as product_name,
      greatest(0, coalesce(r.qty, 0) - coalesce(d.qty, 0))::int as on_hand
    from public.products p
    left join received r on r.product_id = p.id
    left join delivered d on d.product_id = p.id
    where p.id = any($1::uuid[])
    `,
    [productIds]
  )

  const onHandByProduct = new Map(
    rows.map((r) => [String(r.product_id), { name: String(r.product_name ?? 'Product'), on_hand: Number(r.on_hand) || 0 }])
  )

  const overages: string[] = []
  for (const [productId, requested] of requestedByProduct) {
    const stock = onHandByProduct.get(productId)
    const onHand = stock?.on_hand ?? 0
    if (requested > onHand) {
      overages.push(`${stock?.name ?? productId}: requested ${requested}, on hand ${onHand}`)
    }
  }

  if (overages.length > 0) {
    throw new Error(`Cannot deliver more than stock on hand. ${overages.join('; ')}`)
  }
}
