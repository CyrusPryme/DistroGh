/**
 * Import the 5 supplemental delivery rows (from returns gaps) into production.
 * Idempotent — skips barcodes that already have a delivery run.
 *
 * Usage: npx tsx -r dotenv/config scripts/import-supplemental-deliveries-from-returns.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { migrationStr } from '@/lib/migration/fix-workbook'
import { buildDeliveryRowsFromReturnsGaps } from '@/lib/migration/delivery-gap-rows'
import { loadCatalogByBarcode } from '@/lib/migration/fix-workbook'
import { confirmHistoricalDeliveryRun } from '@/lib/migration/historical-delivery-confirm'
import { toSqlDate } from '@/lib/utils'

const RETURNS_INPUT = resolve(process.cwd(), 'returned migration/returns-MAIDEN-FIXED.xlsx')
const SPINTEX_ID = '480a1112-73b0-425d-bab2-287ebcea87e9'

async function main() {
  const { rows: returnRows } = await parseWorkbook(readFileSync(RETURNS_INPUT))
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const barcodes = returnRows.map((r) => migrationStr(r.barcode)).filter(Boolean)
  const catalogByBarcode = await loadCatalogByBarcode(pool, barcodes)
  const gapRows = buildDeliveryRowsFromReturnsGaps(returnRows, catalogByBarcode)

  console.log('Supplemental delivery rows to import:', gapRows.length)

  const client = await pool.connect()
  let inserted = 0
  let skipped = 0

  try {
    await client.query('BEGIN')

    for (const row of gapRows) {
      const bc = migrationStr(row.barcode)
      const { rows: existing } = await client.query(
        `SELECT dr.id FROM delivery_runs dr
         JOIN delivery_run_items dri ON dri.delivery_run_id = dr.id
         JOIN products p ON p.id = dri.product_id
         WHERE dr.deleted_at IS NULL AND p.barcode = $1 LIMIT 1`,
        [bc]
      )
      if (existing[0]) {
        console.log('Skip (already delivered):', bc, row.product_name)
        skipped++
        continue
      }

      const { rows: products } = await client.query(
        `SELECT id FROM products WHERE deleted_at IS NULL AND barcode = $1 LIMIT 1`,
        [bc]
      )
      const productId = products[0]?.id
      if (!productId) {
        throw new Error(`Product not found for barcode ${bc}`)
      }

      const { rows: runs } = await client.query(
        `INSERT INTO delivery_runs
          (supermarket_id, delivery_date, total_transport_cost, notes, source, destination_type)
         VALUES ($1, $2::date, NULL, $3, 'HISTORICAL_MIGRATION', 'BRANCH')
         RETURNING id`,
        [
          SPINTEX_ID,
          toSqlDate(migrationStr(row.delivery_date)),
          `supplemental from returns gap: ${bc}`,
        ]
      )
      const runId = runs[0].id

      await client.query(
        `INSERT INTO delivery_run_items (delivery_run_id, product_id, quantity_delivered)
         VALUES ($1, $2, $3)`,
        [runId, productId, Number(row.quantity)]
      )

      await confirmHistoricalDeliveryRun(client, {
        deliveryRunId: runId,
        supermarketId: SPINTEX_ID,
      })

      console.log('Imported:', bc, row.product_name, 'qty', row.quantity, 'date', row.delivery_date)
      inserted++
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }

  console.log('\nDone. Inserted:', inserted, 'Skipped:', skipped)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
