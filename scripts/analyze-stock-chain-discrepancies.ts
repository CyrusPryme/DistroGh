/**
 * Cross-check intakes (receiving), deliveries, sales, and returns for quantity
 * and chronology discrepancies. Defaults to Palace Spintex for shelf-level checks.
 *
 * Usage: npx tsx -r dotenv/config scripts/analyze-stock-chain-discrepancies.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

type ProductRow = {
  product_id: string
  barcode: string | null
  product_name: string
  received: number
  delivered_all: number
  delivered_palace: number
  sold_palace: number
  returned_palace: number
  inventory_palace: number
  expected_shelf: number
  shelf_variance: number
  warehouse_over_delivered: number
  earliest_intake: string | null
  earliest_delivery: string | null
  earliest_sale: string | null
  earliest_return: string | null
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

async function resolvePalaceSpintexId(): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM supermarkets
     WHERE deleted_at IS NULL AND lower(name) = 'palace' AND lower(coalesce(branch, '')) = 'spintex'
     LIMIT 1`
  )
  return rows[0]?.id ?? null
}

async function loadProductChain(supermarketId: string | null): Promise<ProductRow[]> {
  const { rows } = await pool.query<ProductRow>(
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
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int AS qty
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      WHERE dr.supermarket_id = $1::uuid
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
      COALESCE(r.qty, 0) AS received,
      COALESCE(da.qty, 0) AS delivered_all,
      COALESCE(dp.qty, 0) AS delivered_palace,
      COALESCE(sp.qty, 0) AS sold_palace,
      COALESCE(rp.qty, 0) AS returned_palace,
      COALESCE(ip.qty, 0) AS inventory_palace,
      GREATEST(0, COALESCE(dp.qty, 0) - COALESCE(sp.qty, 0) - COALESCE(rp.qty, 0)) AS expected_shelf,
      COALESCE(ip.qty, 0)
        - GREATEST(0, COALESCE(dp.qty, 0) - COALESCE(sp.qty, 0) - COALESCE(rp.qty, 0)) AS shelf_variance,
      GREATEST(0, COALESCE(da.qty, 0) - COALESCE(r.qty, 0)) AS warehouse_over_delivered,
      r.earliest AS earliest_intake,
      da.earliest AS earliest_delivery,
      sp.earliest AS earliest_sale,
      rp.earliest AS earliest_return
    FROM products p
    LEFT JOIN received r ON r.product_id = p.id
    LEFT JOIN delivered_all da ON da.product_id = p.id
    LEFT JOIN delivered_palace dp ON dp.product_id = p.id
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

function printSamples(title: string, rows: ProductRow[], limit = 15) {
  console.log(`\n=== ${title} (${rows.length}) ===`)
  if (!rows.length) {
    console.log('  None')
    return
  }
  for (const r of rows.slice(0, limit)) {
    console.log(
      `  ${r.product_name}${r.barcode ? ` [${r.barcode}]` : ''}\n` +
        `    received=${fmt(r.received)} delivered(all)=${fmt(r.delivered_all)} ` +
        `palace: del=${fmt(r.delivered_palace)} sold=${fmt(r.sold_palace)} ret=${fmt(r.returned_palace)} ` +
        `inv=${fmt(r.inventory_palace)} expected=${fmt(r.expected_shelf)} variance=${fmt(r.shelf_variance)}`
    )
  }
  if (rows.length > limit) console.log(`  ... and ${rows.length - limit} more`)
}

async function main() {
  const spintexId = await resolvePalaceSpintexId()
  console.log('=== STOCK CHAIN DISCREPANCY ANALYSIS ===')
  console.log('Database:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') ?? '(none)')
  console.log('Palace Spintex supermarket_id:', spintexId ?? 'NOT FOUND')

  if (!spintexId) {
    console.error('Cannot run shelf-level checks without Palace Spintex outlet.')
    process.exit(1)
  }

  const products = await loadProductChain(spintexId)

  const totals = products.reduce(
    (acc, r) => {
      acc.received += r.received
      acc.delivered_all += r.delivered_all
      acc.delivered_palace += r.delivered_palace
      acc.sold_palace += r.sold_palace
      acc.returned_palace += r.returned_palace
      acc.inventory_palace += r.inventory_palace
      acc.expected_shelf += r.expected_shelf
      return acc
    },
    {
      received: 0,
      delivered_all: 0,
      delivered_palace: 0,
      sold_palace: 0,
      returned_palace: 0,
      inventory_palace: 0,
      expected_shelf: 0,
    }
  )

  console.log('\n=== SYSTEM TOTALS (units) ===')
  console.log('  Intakes (warehouse received):     ', fmt(totals.received))
  console.log('  Deliveries (all outlets):         ', fmt(totals.delivered_all))
  console.log('  Deliveries (Palace Spintex):      ', fmt(totals.delivered_palace))
  console.log('  Sales (Palace Spintex):           ', fmt(totals.sold_palace))
  console.log('  Returns (Palace Spintex):         ', fmt(totals.returned_palace))
  console.log('  Implied shelf (del−sold−ret):     ', fmt(totals.expected_shelf))
  console.log('  supermarket_inventory (Spintex):  ', fmt(totals.inventory_palace))
  console.log(
    '  Inventory vs implied shelf:       ',
    fmt(totals.inventory_palace - totals.expected_shelf),
    totals.inventory_palace === totals.expected_shelf ? '✓ balanced' : '⚠ mismatch'
  )

  const warehouseOverDelivered = products.filter((r) => r.warehouse_over_delivered > 0)
  const deliveredNoIntake = products.filter((r) => r.received === 0 && r.delivered_all > 0)
  const shelfOverSold = products.filter(
    (r) => r.delivered_palace < r.sold_palace + r.returned_palace
  )
  const shelfVariance = products.filter((r) => r.shelf_variance !== 0)
  const salesNoDelivery = products.filter((r) => r.sold_palace > 0 && r.delivered_palace === 0)
  const returnsNoDelivery = products.filter((r) => r.returned_palace > 0 && r.delivered_palace === 0)
  const deliveryNoIntake = products.filter((r) => r.delivered_palace > 0 && r.received === 0)

  const deliveryBeforeIntake = products.filter(
    (r) =>
      r.earliest_intake &&
      r.earliest_delivery &&
      r.earliest_delivery < r.earliest_intake
  )
  const saleBeforeDelivery = products.filter(
    (r) =>
      r.earliest_delivery &&
      r.earliest_sale &&
      r.earliest_sale < r.earliest_delivery
  )
  const returnBeforeDelivery = products.filter(
    (r) =>
      r.earliest_delivery &&
      r.earliest_return &&
      r.earliest_return < r.earliest_delivery
  )

  const intakeNoActivity = products.filter(
    (r) => r.received > 0 && r.delivered_all === 0 && r.sold_palace === 0 && r.returned_palace === 0
  )

  printSamples(
    'WAREHOUSE: delivered > received (over-delivery from warehouse)',
    warehouseOverDelivered.sort((a, b) => b.warehouse_over_delivered - a.warehouse_over_delivered)
  )
  printSamples('WAREHOUSE: deliveries but zero intakes', deliveredNoIntake)
  printSamples(
    'PALACE SPINTEX: sold + returned > delivered (impossible shelf)',
    shelfOverSold.sort(
      (a, b) =>
        b.sold_palace + b.returned_palace - b.delivered_palace -
        (a.sold_palace + a.returned_palace - a.delivered_palace)
    )
  )
  printSamples(
    'PALACE SPINTEX: inventory ≠ expected shelf (delivered − sold − returns)',
    shelfVariance.sort((a, b) => Math.abs(b.shelf_variance) - Math.abs(a.shelf_variance))
  )
  printSamples('PALACE SPINTEX: sales but no delivery to Spintex', salesNoDelivery)
  printSamples('PALACE SPINTEX: returns but no delivery to Spintex', returnsNoDelivery)
  printSamples('PALACE SPINTEX: deliveries but no warehouse intake', deliveryNoIntake)

  console.log('\n=== CHRONOLOGY ISSUES ===')
  console.log('  Delivery before earliest intake:', deliveryBeforeIntake.length)
  deliveryBeforeIntake.slice(0, 8).forEach((r) =>
    console.log(`    ${r.product_name}: delivery ${r.earliest_delivery} < intake ${r.earliest_intake}`)
  )
  console.log('  Sale before earliest delivery (Spintex):', saleBeforeDelivery.length)
  saleBeforeDelivery.slice(0, 8).forEach((r) =>
    console.log(`    ${r.product_name}: sale ${r.earliest_sale} < delivery ${r.earliest_delivery}`)
  )
  console.log('  Return before earliest delivery (Spintex):', returnBeforeDelivery.length)
  returnBeforeDelivery.slice(0, 8).forEach((r) =>
    console.log(`    ${r.product_name}: return ${r.earliest_return} < delivery ${r.earliest_delivery}`)
  )

  console.log('\n=== OTHER ===')
  console.log('  Products with intakes but no deliveries/sales/returns:', intakeNoActivity.length)
  console.log('  Products in chain (any activity):', products.length)

  const blockers = [
    warehouseOverDelivered.length && `${warehouseOverDelivered.length} products over-delivered from warehouse`,
    shelfOverSold.length && `${shelfOverSold.length} products with sold+returned > delivered at Spintex`,
    salesNoDelivery.length && `${salesNoDelivery.length} products with sales but no Spintex delivery`,
    returnsNoDelivery.length && `${returnsNoDelivery.length} products with returns but no Spintex delivery`,
    Math.abs(totals.inventory_palace - totals.expected_shelf) > 0 &&
      `Total Spintex inventory off by ${totals.inventory_palace - totals.expected_shelf} units vs implied shelf`,
  ].filter(Boolean)

  console.log('\n=== SUMMARY ===')
  if (blockers.length) {
    console.log('Discrepancies found:')
    blockers.forEach((b) => console.log('  -', b))
  } else {
    console.log('No major quantity discrepancies detected across the chain.')
  }
  if (deliveryBeforeIntake.length || saleBeforeDelivery.length || returnBeforeDelivery.length) {
    console.log(
      'Chronology warnings:',
      [
        deliveryBeforeIntake.length && `${deliveryBeforeIntake.length} delivery-before-intake`,
        saleBeforeDelivery.length && `${saleBeforeDelivery.length} sale-before-delivery`,
        returnBeforeDelivery.length && `${returnBeforeDelivery.length} return-before-delivery`,
      ]
        .filter(Boolean)
        .join(', ')
    )
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
