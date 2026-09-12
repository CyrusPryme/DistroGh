/**
 * Apply CORRECTING DELIVERIES *.xlsx — Spintex delivery date fixes + missing delivery backfills.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/apply-correcting-deliveries-workbook.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-correcting-deliveries-workbook.ts dotenv_config_path=.env.local --apply
 *   npx tsx -r dotenv/config scripts/apply-correcting-deliveries-workbook.ts dotenv_config_path=.env.local --file "discrepancies fix/CORRECTING DELIVERIES 3.xlsx" --apply
 */
import 'dotenv/config'
import pg from 'pg'
import { confirmHistoricalDeliveryRun } from '@/lib/migration/historical-delivery-confirm'
import {
  buildDeliveryCorrectionPlan,
  CORRECTING_DELIVERIES_3_FILE,
  CORRECTING_DELIVERIES_3_REF,
  findSpintexDeliveryRuns,
  insertDeliveryAllowed,
  loadSystemCorrectRows,
  pickRunForAuthoritativeDate,
  type DeliveryCorrectionAction,
  type DeliveryRunMatch,
} from '@/lib/migration/admin-delivery-corrections'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const APPLY = process.argv.includes('--apply')
const fileArgIdx = process.argv.indexOf('--file')
const filePath = fileArgIdx >= 0 ? process.argv[fileArgIdx + 1]! : CORRECTING_DELIVERIES_3_FILE

function describe(action: DeliveryCorrectionAction): string {
  const rows = `R${action.sourceRows.join(',R')}`
  const name = action.product.product_name.slice(0, 42)
  if (action.kind === 'update_delivery_date') {
    return `${rows} delivery ${action.fromDate}→${action.toDate} ×${action.matchQty} | ${name}`
  }
  return `${rows} NEW delivery ${action.deliveryDate}×${action.qty} | ${name}`
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

  const rows = await loadSystemCorrectRows(filePath)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const chainRows = await loadStockChainProducts(pool, spintexId)
  const chainByProductId = new Map(chainRows.map((r) => [r.product_id, r]))

  const { actions, unresolved, skipped: parseSkipped } = await buildDeliveryCorrectionPlan(pool, rows)

  console.log(`=== Correcting deliveries workbook (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('File:', filePath)
  console.log('Rows:', rows.length)
  console.log(
    'Actions:',
    actions.length,
    `(date ${actions.filter((a) => a.kind === 'update_delivery_date').length}, insert ${actions.filter((a) => a.kind === 'insert_delivery').length})`
  )

  if (parseSkipped.length) {
    console.log('\n=== PARSE SKIPPED ===')
    parseSkipped.forEach((s) => console.log(s))
  }
  if (unresolved.length) {
    console.log('\n=== UNRESOLVED ===')
    unresolved.forEach((u) => console.log(u))
  }

  const client = await pool.connect()
  const applied: string[] = []
  const skipped: string[] = []
  const appliedInsertKeys = new Set<string>()
  const updatedRunIds = new Set<string>()

  async function resolveRunForDateFix(
    productId: string,
    fromDate: string,
    toDate: string,
    matchQty: number
  ) {
    const atTarget = await findSpintexDeliveryRuns(client, productId, spintexId, {
      onDate: toDate,
      qty: matchQty,
    })
    if (atTarget.length) return { kind: 'skip' as const, reason: `already on ${toDate}×${matchQty}` }

    const exact = await findSpintexDeliveryRuns(client, productId, spintexId, {
      onDate: fromDate,
      qty: matchQty,
    })
    if (exact.length === 1) return { kind: 'run' as const, run: exact[0]! }
    if (exact.length > 1) return { kind: 'skip' as const, reason: `ambiguous ${exact.length} on ${fromDate}` }

    const byQty = await findSpintexDeliveryRuns(client, productId, spintexId, { qty: matchQty })
    const candidates = byQty.filter((r) => r.delivery_date.slice(0, 10) !== toDate)
    const picked = pickRunForAuthoritativeDate(candidates, toDate)
    if (picked) return { kind: 'run' as const, run: picked }
    return { kind: 'skip' as const, reason: `no run on ${fromDate}×${matchQty}` }
  }

  async function applyDeliveryDateToRun(run: DeliveryRunMatch, toDate: string, label: string) {
    if (updatedRunIds.has(run.delivery_run_id)) {
      skipped.push(`${label} — run ${run.delivery_run_id.slice(0, 8)} already updated this batch`)
      return
    }
    if (run.delivery_date.slice(0, 10) === toDate) {
      skipped.push(`${label} — already on ${toDate}`)
      return
    }
    if (APPLY) {
      await client.query(
        `UPDATE delivery_runs SET delivery_date = $1::date,
         notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN $2 ELSE ' | ' || $2 END
         WHERE id = $3::uuid AND deleted_at IS NULL`,
        [toDate, CORRECTING_DELIVERIES_3_REF, run.delivery_run_id]
      )
    }
    updatedRunIds.add(run.delivery_run_id)
    applied.push(
      `${label} → ${APPLY ? 'updated' : 'would update'} run ${run.delivery_run_id} (was ${run.delivery_date.slice(0, 10)})`
    )
  }

  try {
    if (APPLY) await client.query('BEGIN')

    for (const action of actions) {
      const label = describe(action)
      const chain = chainByProductId.get(action.product.product_id)

      if (action.kind === 'update_delivery_date') {
        const resolved = await resolveRunForDateFix(
          action.product.product_id,
          action.fromDate,
          action.toDate,
          action.matchQty
        )
        if (resolved.kind === 'skip') {
          skipped.push(`${label} — ${resolved.reason}`)
          continue
        }
        await applyDeliveryDateToRun(resolved.run, action.toDate, label)
        continue
      }

      if (action.kind === 'insert_delivery') {
        const key = `${action.product.product_id}:${action.deliveryDate}:${action.qty}`
        if (appliedInsertKeys.has(key)) {
          skipped.push(`${label} — duplicate row in workbook`)
          continue
        }

        const existing = await findSpintexDeliveryRuns(client, action.product.product_id, spintexId, {
          onDate: action.deliveryDate,
          qty: action.qty,
        })
        if (existing.length) {
          skipped.push(`${label} — already on ${action.deliveryDate}×${action.qty}`)
          appliedInsertKeys.add(key)
          continue
        }

        const byQty = await findSpintexDeliveryRuns(client, action.product.product_id, spintexId, {
          qty: action.qty,
        })
        const redateCandidates = byQty.filter((r) => r.delivery_date.slice(0, 10) !== action.deliveryDate)
        const picked = pickRunForAuthoritativeDate(redateCandidates, action.deliveryDate)
        if (picked) {
          const redateLabel = `${label} (redate existing, overwrite prior fix)`
          await applyDeliveryDateToRun(picked, action.deliveryDate, redateLabel)
          appliedInsertKeys.add(key)
          continue
        }

        const allowed = insertDeliveryAllowed(chain, action.qty, existing)
        if (!allowed.ok) {
          skipped.push(`${label} — ${allowed.reason}`)
          continue
        }

        if (APPLY) {
          const { rows: newRun } = await client.query<{ id: string }>(
            `INSERT INTO delivery_runs (supermarket_id, delivery_date, total_transport_cost, notes, source, destination_type)
             VALUES ($1::uuid, $2::date, NULL, $3, 'HISTORICAL_MIGRATION', 'BRANCH')
             RETURNING id`,
            [spintexId, action.deliveryDate, `${CORRECTING_DELIVERIES_3_REF}:insert`]
          )
          await client.query(
            `INSERT INTO delivery_run_items (delivery_run_id, product_id, quantity_delivered)
             VALUES ($1::uuid, $2::uuid, $3)`,
            [newRun[0]!.id, action.product.product_id, action.qty]
          )
          await confirmHistoricalDeliveryRun(client, {
            deliveryRunId: newRun[0]!.id,
            supermarketId: spintexId,
          })
        }
        appliedInsertKeys.add(key)
        applied.push(`${label} → ${APPLY ? 'inserted' : 'would insert'}`)
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
  applied.forEach((l) => console.log(' ', l))
  if (skipped.length) {
    console.log('\n=== SKIPPED ===')
    skipped.forEach((l) => console.log(' ', l))
  }
  console.log('\n=== SUMMARY ===')
  console.log(`Applied/planned: ${applied.length}, Skipped: ${skipped.length}, Unresolved: ${unresolved.length}`)
  if (!APPLY) console.log('\nRe-run with --apply to commit.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
