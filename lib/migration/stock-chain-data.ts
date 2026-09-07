/**
 * Load per-product intakes / deliveries / sales / returns / inventory totals for chain analysis.
 */
import type { Pool } from 'pg'

export type StockChainProductRow = {
  product_id: string
  barcode: string | null
  product_name: string
  vendor_name: string | null
  received: number
  /** All delivery runs (any destination). */
  delivered_all: number
  /** Deliveries recorded at Palace Spintex. */
  delivered_palace: number
  /** Deliveries to any Palace supermarket branch (Spintex + other Palace locations). */
  delivered_palace_chain: number
  /** Palace chain deliveries not at Spintex (internal transfer / other branch). */
  delivered_palace_other: number
  sold_palace: number
  returned_palace: number
  inventory_palace: number
  expected_shelf: number
  shelf_variance: number
  warehouse_over_delivered: number
  earliest_intake: string | null
  earliest_delivery: string | null
  earliest_delivery_spintex: string | null
  earliest_sale: string | null
  earliest_return: string | null
}

export async function resolvePalaceSpintexId(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM supermarkets
     WHERE deleted_at IS NULL AND lower(name) = 'palace' AND lower(coalesce(branch, '')) = 'spintex'
     LIMIT 1`
  )
  return rows[0]?.id ?? null
}

export async function loadStockChainProducts(
  pool: Pool,
  supermarketId: string
): Promise<StockChainProductRow[]> {
  const { rows } = await pool.query<StockChainProductRow>(
    `
    WITH received AS (
      SELECT i.product_id, SUM(i.quantity_received)::int AS qty, MIN(i.received_date)::text AS earliest
      FROM intakes i
      WHERE i.deleted_at IS NULL
      GROUP BY i.product_id
    ),
    delivered_all AS (
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int AS qty, MIN(dr.delivery_date)::text AS earliest
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      GROUP BY dri.product_id
    ),
    delivered_palace AS (
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int AS qty, MIN(dr.delivery_date)::text AS earliest
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      WHERE dr.supermarket_id = $1::uuid
      GROUP BY dri.product_id
    ),
    delivered_palace_chain AS (
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int AS qty
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      JOIN supermarkets sm ON sm.id = dr.supermarket_id AND sm.deleted_at IS NULL
      WHERE lower(sm.name) = 'palace'
      GROUP BY dri.product_id
    ),
    sold_palace AS (
      SELECT s.product_id, SUM(s.qty_sold)::int AS qty, MIN(s.week_start)::text AS earliest
      FROM sales s
      WHERE s.deleted_at IS NULL AND s.supermarket_id = $1::uuid
      GROUP BY s.product_id
    ),
    returned_palace AS (
      SELECT pr.product_id, SUM(pr.quantity_returned)::int AS qty, MIN(pr.return_date)::text AS earliest
      FROM product_returns pr
      WHERE pr.deleted_at IS NULL AND pr.supermarket_id = $1::uuid
      GROUP BY pr.product_id
    ),
    inventory_palace AS (
      SELECT si.product_id, si.quantity::int AS qty
      FROM supermarket_inventory si
      WHERE si.supermarket_id = $1::uuid
    )
    SELECT
      p.id AS product_id,
      p.barcode,
      p.name AS product_name,
      v.name AS vendor_name,
      COALESCE(r.qty, 0) AS received,
      COALESCE(da.qty, 0) AS delivered_all,
      COALESCE(dp.qty, 0) AS delivered_palace,
      COALESCE(dpc.qty, 0) AS delivered_palace_chain,
      GREATEST(0, COALESCE(dpc.qty, 0) - COALESCE(dp.qty, 0)) AS delivered_palace_other,
      COALESCE(sp.qty, 0) AS sold_palace,
      COALESCE(rp.qty, 0) AS returned_palace,
      COALESCE(ip.qty, 0) AS inventory_palace,
      GREATEST(0, COALESCE(dp.qty, 0) - COALESCE(sp.qty, 0) - COALESCE(rp.qty, 0)) AS expected_shelf,
      COALESCE(ip.qty, 0)
        - GREATEST(0, COALESCE(dp.qty, 0) - COALESCE(sp.qty, 0) - COALESCE(rp.qty, 0)) AS shelf_variance,
      GREATEST(0, COALESCE(da.qty, 0) - COALESCE(r.qty, 0)) AS warehouse_over_delivered,
      r.earliest AS earliest_intake,
      da.earliest AS earliest_delivery,
      dp.earliest AS earliest_delivery_spintex,
      sp.earliest AS earliest_sale,
      rp.earliest AS earliest_return
    FROM products p
    LEFT JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
    LEFT JOIN received r ON r.product_id = p.id
    LEFT JOIN delivered_all da ON da.product_id = p.id
    LEFT JOIN delivered_palace dp ON dp.product_id = p.id
    LEFT JOIN delivered_palace_chain dpc ON dpc.product_id = p.id
    LEFT JOIN sold_palace sp ON sp.product_id = p.id
    LEFT JOIN returned_palace rp ON rp.product_id = p.id
    LEFT JOIN inventory_palace ip ON ip.product_id = p.id
    WHERE p.deleted_at IS NULL
      AND (
        COALESCE(r.qty, 0) > 0
        OR COALESCE(da.qty, 0) > 0
        OR COALESCE(dp.qty, 0) > 0
        OR COALESCE(sp.qty, 0) > 0
        OR COALESCE(rp.qty, 0) > 0
      )
    ORDER BY p.name
    `,
    [supermarketId]
  )
  return rows
}

export function dateDaysBefore(iso: string, daysBefore: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - daysBefore)
  return d.toISOString().slice(0, 10)
}
