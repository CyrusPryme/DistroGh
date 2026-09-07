/**
 * Apply chronology date fixes from stock-chain analysis (CHRONOLOGY-FIX.xlsx logic).
 * Accepts AUTO and ADMIN issues — adjusts earliest intake or Spintex delivery dates.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/apply-chronology-fixes.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-chronology-fixes.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'
import {
  buildChronologyIssues,
  buildDeliveryFixRows,
} from '@/lib/migration/discrepancy-auto-fix'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const APPLY = process.argv.includes('--apply')
const REF = 'chronology-fix:auto-confirm'

async function resolveProductId(
  client: pg.PoolClient,
  barcode: string,
  productName: string
): Promise<string | null> {
  if (barcode) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE deleted_at IS NULL AND barcode = $1 LIMIT 1`,
      [barcode]
    )
    if (rows[0]) return rows[0].id
  }
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM products WHERE deleted_at IS NULL AND lower(trim(name)) = lower(trim($1)) LIMIT 1`,
    [productName]
  )
  return rows[0]?.id ?? null
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const products = await loadStockChainProducts(pool, spintexId)
  const { autoBarcodes } = buildDeliveryFixRows(products)
  const issues = buildChronologyIssues(products, autoBarcodes)

  console.log(`=== Chronology fixes (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('Issues:', issues.length, `(AUTO ${issues.filter((i) => i.meta.disposition === 'auto').length}, ADMIN ${issues.filter((i) => i.meta.disposition === 'admin').length})`)

  const client = await pool.connect()
  let intakeUpdates = 0
  let deliveryUpdates = 0
  const skipped: string[] = []
  const applied: string[] = []

  try {
    if (APPLY) await client.query('BEGIN')

    for (const issue of issues) {
      const productId = await resolveProductId(client, issue.barcode, issue.product_name)
      if (!productId) {
        skipped.push(`${issue.issue_type} ${issue.product_name}: product not found`)
        continue
      }

      if (issue.issue_type === 'DELIVERY_BEFORE_INTAKE') {
        const { rows: intakes } = await client.query<{ id: string; received_date: string }>(
          `SELECT id, received_date::text FROM intakes
           WHERE deleted_at IS NULL AND product_id = $1::uuid
           ORDER BY received_date ASC, created_at ASC LIMIT 1`,
          [productId]
        )
        const intake = intakes[0]
        if (!intake) {
          skipped.push(`${issue.product_name}: no intake to backdate`)
          continue
        }
        const cur = intake.received_date.slice(0, 10)
        if (cur <= issue.suggested_date) {
          skipped.push(`${issue.product_name}: intake already ${cur} ≤ ${issue.suggested_date}`)
          continue
        }
        if (APPLY) {
          await client.query(
            `UPDATE intakes SET received_date = $1::date,
             reference = COALESCE(NULLIF(reference, ''), $2)
             WHERE id = $3::uuid`,
            [issue.suggested_date, REF, intake.id]
          )
        }
        intakeUpdates++
        applied.push(
          `INTAKE ${issue.product_name.slice(0, 40)}: ${cur} → ${issue.suggested_date} (${issue.meta.disposition.toUpperCase()})`
        )
        continue
      }

      if (issue.issue_type === 'SALE_BEFORE_DELIVERY') {
        const { rows: deliveries } = await client.query<{ id: string; delivery_date: string }>(
          `SELECT dr.id, dr.delivery_date::text
           FROM delivery_run_items dri
           JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
           WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid
           ORDER BY dr.delivery_date ASC, dr.created_at ASC LIMIT 1`,
          [productId, spintexId]
        )
        const delivery = deliveries[0]
        if (!delivery) {
          skipped.push(`${issue.product_name}: no Spintex delivery to backdate`)
          continue
        }
        const cur = delivery.delivery_date.slice(0, 10)
        if (cur <= issue.suggested_date) {
          skipped.push(`${issue.product_name}: delivery already ${cur} ≤ ${issue.suggested_date}`)
          continue
        }
        if (APPLY) {
          await client.query(
            `UPDATE delivery_runs SET delivery_date = $1::date,
             notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN $2 ELSE ' | ' || $2 END
             WHERE id = $3::uuid`,
            [issue.suggested_date, REF, delivery.id]
          )
        }
        deliveryUpdates++
        applied.push(
          `DELIVERY ${issue.product_name.slice(0, 40)}: ${cur} → ${issue.suggested_date} (${issue.meta.disposition.toUpperCase()})`
        )
      }
    }

    if (APPLY) await client.query('COMMIT')
  } catch (e) {
    if (APPLY) await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }

  console.log('\n=== APPLIED / PLANNED ===')
  applied.forEach((l) => console.log(l))
  if (skipped.length) {
    console.log('\n=== SKIPPED ===')
    skipped.forEach((l) => console.log(l))
  }
  console.log('\n=== SUMMARY ===')
  console.log(`Intake date fixes: ${intakeUpdates}`)
  console.log(`Delivery date fixes: ${deliveryUpdates}`)
  console.log(`Skipped: ${skipped.length}`)
  if (!APPLY) console.log('\nRe-run with --apply to commit.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
