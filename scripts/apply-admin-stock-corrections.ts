/**
 * Apply admin-confirmed stock-chain corrections (intakes, deliveries, inventory).
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/apply-admin-stock-corrections.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-admin-stock-corrections.ts dotenv_config_path=.env.local --apply
 *   npx tsx -r dotenv/config scripts/apply-admin-stock-corrections.ts dotenv_config_path=.env.local --id adepa-butter-cereal-legume-flou --apply
 */
import 'dotenv/config'
import pg from 'pg'
import {
  ADMIN_STOCK_CORRECTION_REF,
  ADMIN_STOCK_CORRECTIONS,
  buildStockCorrectionPlan,
  chainBalancedAfterCorrection,
  describeStockCorrectionPlan,
  type ProductStockCorrectionSpec,
} from '@/lib/migration/admin-stock-corrections'
import { confirmHistoricalDeliveryRun } from '@/lib/migration/historical-delivery-confirm'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const APPLY = process.argv.includes('--apply')
const idArg = process.argv.find((a, i) => process.argv[i - 1] === '--id')

function selectSpecs(): ProductStockCorrectionSpec[] {
  if (idArg) {
    const spec = ADMIN_STOCK_CORRECTIONS.find((s) => s.id === idArg)
    if (!spec) throw new Error(`Unknown correction id: ${idArg}`)
    return [spec]
  }
  return ADMIN_STOCK_CORRECTIONS
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

  const specs = selectSpecs()
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const chainRows = await loadStockChainProducts(pool, spintexId)
  const chainByProductId = new Map(chainRows.map((r) => [r.product_id, r]))

  console.log(`=== Admin stock corrections (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('Specs:', specs.map((s) => s.id).join(', '))

  const client = await pool.connect()
  const applied: string[] = []
  const skipped: string[] = []

  try {
    if (APPLY) await client.query('BEGIN')

    for (const spec of specs) {
      const productRow = chainRows.find((r) => r.barcode === spec.barcode)
      if (!productRow) {
        skipped.push(`${spec.id}: product not in stock chain`)
        continue
      }

      const plan = await buildStockCorrectionPlan(client, spec, productRow, spintexId)
      if (!plan) {
        skipped.push(`${spec.id}: product not found in catalog`)
        continue
      }

      console.log('\n' + describeStockCorrectionPlan(plan).join('\n'))

      if (plan.warnings.some((w) => w.startsWith('Expected exactly one intake'))) {
        skipped.push(`${spec.id}: intake match failed`)
        continue
      }
      if (plan.warnings.some((w) => w.startsWith('After removals, received'))) {
        skipped.push(`${spec.id}: received total would not match target`)
        continue
      }

      if (!APPLY) {
        applied.push(`${spec.id}: would apply`)
        continue
      }

      for (const intakeId of plan.remove_intake_ids) {
        await client.query(
          `UPDATE intakes
           SET deleted_at = now(),
               reference = COALESCE(NULLIF(reference, ''), $2)
           WHERE id = $1::uuid AND deleted_at IS NULL`,
          [intakeId, ADMIN_STOCK_CORRECTION_REF]
        )
      }

      for (const runId of plan.remove_delivery_run_ids) {
        await client.query(
          `UPDATE delivery_runs
           SET deleted_at = now(),
               notes = COALESCE(notes, '') || ' [' || $2 || ']'
           WHERE id = $1::uuid AND deleted_at IS NULL`,
          [runId, ADMIN_STOCK_CORRECTION_REF]
        )
      }

      const { rows: runs } = await client.query<{ id: string }>(
        `INSERT INTO delivery_runs
          (supermarket_id, delivery_date, total_transport_cost, notes, source, destination_type)
         VALUES ($1::uuid, $2::date, NULL, $3, 'HISTORICAL_MIGRATION', 'BRANCH')
         RETURNING id`,
        [
          spintexId,
          spec.delivery.delivery_date,
          `${ADMIN_STOCK_CORRECTION_REF}:${spec.id}`,
        ]
      )
      const runId = runs[0].id

      await client.query(
        `INSERT INTO delivery_run_items (delivery_run_id, product_id, quantity_delivered)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [runId, plan.product.product_id, spec.delivery.quantity_delivered]
      )

      await confirmHistoricalDeliveryRun(client, {
        deliveryRunId: runId,
        supermarketId: spintexId,
      })

      const { rows: inv } = await client.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM supermarket_inventory
         WHERE supermarket_id = $1::uuid AND product_id = $2::uuid
         FOR UPDATE`,
        [spintexId, plan.product.product_id]
      )
      if (inv[0]) {
        await client.query(
          `UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`,
          [inv[0].id, plan.target_inventory]
        )
      } else if (plan.target_inventory > 0) {
        await client.query(
          `INSERT INTO supermarket_inventory (supermarket_id, product_id, quantity)
           VALUES ($1::uuid, $2::uuid, $3)`,
          [spintexId, plan.product.product_id, plan.target_inventory]
        )
      }

      applied.push(`${spec.id}: applied (delivery run ${runId})`)
    }

    if (APPLY) await client.query('COMMIT')

    console.log('\n=== RESULT ===')
    applied.forEach((a) => console.log('  ✓', a))
    skipped.forEach((s) => console.log('  ✗', s))

    if (APPLY && applied.length) {
      const afterChain = await loadStockChainProducts(pool, spintexId)
      for (const spec of specs) {
        const row = afterChain.find((r) => r.barcode === spec.barcode)
        if (!row) continue
        const ok = chainBalancedAfterCorrection(row)
        console.log(
          `\nPost-check ${spec.id}:`,
          ok ? 'BALANCED' : 'NOT BALANCED',
          `(received=${row.received} delivered=${row.delivered_palace} sold=${row.sold_palace} returned=${row.returned_palace} shelf=${row.inventory_palace} variance=${row.shelf_variance})`
        )
      }
    }
  } catch (e) {
    if (APPLY) await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
