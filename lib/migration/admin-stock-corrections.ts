/**
 * Admin-confirmed stock-chain corrections for specific products.
 * Adjusts intakes, Spintex deliveries, and shelf inventory while leaving sales untouched.
 */
import type { Pool, PoolClient } from 'pg'
import { impliedExpectedShelf, spintexOutflow } from '@/lib/migration/discrepancy-auto-fix'
import type { StockChainProductRow } from '@/lib/migration/stock-chain-data'

export const ADMIN_STOCK_CORRECTION_REF = 'admin-correction:stock-chain'

export type IntakeRemoveSpec = {
  quantity_received: number
  received_date: string
}

export type ProductStockCorrectionSpec = {
  id: string
  barcode: string
  vendor_name: string
  product_name: string
  received_total: number
  delivered_spintex_total: number
  returned_spintex_total: number
  /** Intakes to soft-delete (must exist exactly). */
  remove_intakes: IntakeRemoveSpec[]
  /** Replace all Spintex delivery items with one confirmed run. */
  delivery: {
    quantity_delivered: number
    delivery_date: string
  }
}

/** Admin-confirmed corrections — extend this list as more products are verified. */
export const ADMIN_STOCK_CORRECTIONS: ProductStockCorrectionSpec[] = [
  {
    id: 'adepa-butter-cereal-legume-flou',
    barcode: '603602777111',
    vendor_name: 'ADEPA CEREAL',
    product_name: 'ADEPA BUTTER CEREAL LEGUME FLOU',
    received_total: 160,
    delivered_spintex_total: 160,
    returned_spintex_total: 5,
    remove_intakes: [
      { quantity_received: 8, received_date: '2025-08-02' },
      { quantity_received: 5, received_date: '2026-04-17' },
    ],
    delivery: {
      quantity_delivered: 160,
      delivery_date: '2025-10-08',
    },
  },
]

export type ResolvedStockProduct = {
  product_id: string
  vendor_id: string
  product_name: string
  vendor_name: string
  barcode: string
}

export type StockCorrectionPlan = {
  spec: ProductStockCorrectionSpec
  product: ResolvedStockProduct
  chain: StockChainProductRow
  remove_intake_ids: string[]
  remove_delivery_run_ids: string[]
  target_inventory: number
  warnings: string[]
}

function sqlDate(d: string | Date): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return d.slice(0, 10)
}

export async function resolveStockProduct(
  client: Pool | PoolClient,
  spec: ProductStockCorrectionSpec
): Promise<ResolvedStockProduct | null> {
  const { rows } = await client.query<ResolvedStockProduct>(
    `SELECT p.id AS product_id, p.vendor_id, p.name AS product_name, p.barcode,
            v.name AS vendor_name
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.deleted_at IS NULL AND p.barcode = $1
     LIMIT 1`,
    [spec.barcode]
  )
  return rows[0] ?? null
}

export async function buildStockCorrectionPlan(
  client: Pool | PoolClient,
  spec: ProductStockCorrectionSpec,
  chain: StockChainProductRow,
  spintexId: string
): Promise<StockCorrectionPlan | null> {
  const product = await resolveStockProduct(client, spec)
  if (!product) return null

  const warnings: string[] = []
  const remove_intake_ids: string[] = []

  for (const remove of spec.remove_intakes) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM intakes
       WHERE deleted_at IS NULL AND product_id = $1::uuid
         AND quantity_received = $2 AND received_date = $3::date`,
      [product.product_id, remove.quantity_received, remove.received_date]
    )
    if (rows.length !== 1) {
      warnings.push(
        `Expected exactly one intake ${remove.received_date}×${remove.quantity_received}, found ${rows.length}`
      )
    } else {
      remove_intake_ids.push(rows[0].id)
    }
  }

  const { rows: remainingIntakes } = await client.query<{ total: number }>(
    `SELECT COALESCE(SUM(quantity_received), 0)::int AS total
     FROM intakes
     WHERE deleted_at IS NULL AND product_id = $1::uuid
       AND id <> ALL($2::uuid[])`,
    [product.product_id, remove_intake_ids.length ? remove_intake_ids : ['00000000-0000-0000-0000-000000000000']]
  )
  if (Number(remainingIntakes[0]?.total ?? 0) !== spec.received_total) {
    warnings.push(
      `After removals, received would be ${remainingIntakes[0]?.total ?? 0}, target ${spec.received_total}`
    )
  }

  if (chain.returned_palace !== spec.returned_spintex_total) {
    warnings.push(
      `Returns at Spintex are ${chain.returned_palace}, expected ${spec.returned_spintex_total} — sales/returns not modified`
    )
  }

  const { rows: deliveryRuns } = await client.query<{ delivery_run_id: string }>(
    `SELECT DISTINCT dr.id AS delivery_run_id
     FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
     WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid`,
    [product.product_id, spintexId]
  )
  const remove_delivery_run_ids = deliveryRuns.map((r) => r.delivery_run_id)

  const projectedChain: StockChainProductRow = {
    ...chain,
    received: spec.received_total,
    delivered_all: spec.delivered_spintex_total,
    delivered_palace: spec.delivered_spintex_total,
    delivered_palace_chain: spec.delivered_spintex_total,
    delivered_palace_other: 0,
    returned_palace: spec.returned_spintex_total,
    warehouse_over_delivered: 0,
  }
  const target_inventory = impliedExpectedShelf(projectedChain)

  if (spintexOutflow(chain) !== chain.sold_palace + chain.returned_palace) {
    warnings.push('Spintex outflow mismatch in chain row — verify sold/returned totals')
  }

  return {
    spec,
    product,
    chain,
    remove_intake_ids,
    remove_delivery_run_ids,
    target_inventory,
    warnings,
  }
}

export function describeStockCorrectionPlan(plan: StockCorrectionPlan): string[] {
  const lines = [
    `${plan.product.vendor_name} / ${plan.product.product_name} (${plan.product.barcode})`,
    `  received: ${plan.chain.received} → ${plan.spec.received_total}`,
    `  delivered (Spintex): ${plan.chain.delivered_palace} → ${plan.spec.delivered_spintex_total}`,
    `  sold (Spintex, unchanged): ${plan.chain.sold_palace}`,
    `  returned (Spintex): ${plan.chain.returned_palace} (target ${plan.spec.returned_spintex_total})`,
    `  inventory (Spintex): ${plan.chain.inventory_palace} → ${plan.target_inventory}`,
    `  remove intakes: ${plan.remove_intake_ids.length}`,
    `  replace delivery runs: ${plan.remove_delivery_run_ids.length} → 1×${plan.spec.delivery.quantity_delivered} on ${plan.spec.delivery.delivery_date}`,
  ]
  if (plan.warnings.length) lines.push(`  warnings: ${plan.warnings.join('; ')}`)
  return lines
}

export function chainBalancedAfterCorrection(
  row: Pick<
    StockChainProductRow,
    | 'received'
    | 'delivered_palace'
    | 'sold_palace'
    | 'returned_palace'
    | 'inventory_palace'
    | 'warehouse_over_delivered'
    | 'shelf_variance'
  >
): boolean {
  const expectedShelf = impliedExpectedShelf({
    ...row,
    delivered_all: row.delivered_palace,
    delivered_palace_chain: row.delivered_palace,
    delivered_palace_other: 0,
    barcode: null,
    product_id: '',
    product_name: '',
    vendor_name: null,
    expected_shelf: 0,
    earliest_intake: null,
    earliest_delivery: null,
    earliest_delivery_spintex: null,
    earliest_sale: null,
    earliest_return: null,
  })
  return (
    row.warehouse_over_delivered === 0 &&
    row.shelf_variance === 0 &&
    row.inventory_palace === expectedShelf &&
    row.received >= row.delivered_palace
  )
}

export { sqlDate }
