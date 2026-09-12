/**
 * Apply SYSTEM CORRECT *.xlsx intake/delivery corrections.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/apply-system-correct-workbook.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-system-correct-workbook.ts dotenv_config_path=.env.local --apply
 *   npx tsx -r dotenv/config scripts/apply-system-correct-workbook.ts dotenv_config_path=.env.local --file "discrepancies fix/SYSTEM CORRECT FARMER TORKS 2.xlsx" --apply
 */
import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'
import { impliedExpectedShelf } from '@/lib/migration/discrepancy-auto-fix'
import { confirmHistoricalDeliveryRun } from '@/lib/migration/historical-delivery-confirm'
import {
  buildSystemCorrectPlan,
  findIntakesForDelete,
  loadSystemCorrectRows,
  SYSTEM_CORRECT_FILE,
  SYSTEM_CORRECT_REF,
  type SystemCorrectAction,
} from '@/lib/migration/system-correct-workbook'
import type { IntakeMatch } from '@/lib/migration/admin-intake-corrections'
import { findIntakesForAction } from '@/lib/migration/admin-intake-corrections'

const APPLY = process.argv.includes('--apply')
const fileArgIdx = process.argv.indexOf('--file')
const filePath = fileArgIdx >= 0 ? process.argv[fileArgIdx + 1] : SYSTEM_CORRECT_FILE

function describe(action: SystemCorrectAction): string {
  const rows = `R${action.sourceRows.join(',R')}`
  const name = action.product.product_name.slice(0, 42)
  switch (action.kind) {
    case 'delete':
      return `${rows} DELETE ${action.onDate}${action.matchQty != null ? `×${action.matchQty}` : ''} | ${name}`
    case 'update_date':
      return `${rows} date ${action.fromDate}→${action.toDate}${action.matchQty != null ? ` (match qty ${action.matchQty})` : ''}${action.toQty != null ? ` qty→${action.toQty}` : ''} | ${name}`
    case 'update_qty':
      return `${rows} qty ${action.fromQty}→${action.toQty}${action.onDate ? ` on ${action.onDate}` : ''} | ${name}`
    case 'insert':
      return `${rows} NEW intake ${action.receivedDate}×${action.qty} | ${name}`
    case 'delivery_target':
      return `${rows} delivered→${action.deliveredTotal} | ${name} (${action.notes})`
  }
}

async function findIntakesByDateQty(
  client: pg.PoolClient,
  productId: string,
  fromDate: string,
  matchQty?: number
): Promise<IntakeMatch[]> {
  const params: unknown[] = [productId, fromDate]
  let sql = `SELECT id, received_date::text, quantity_received FROM intakes
             WHERE deleted_at IS NULL AND product_id = $1::uuid AND received_date = $2::date`
  if (matchQty != null) {
    params.push(matchQty)
    sql += ` AND quantity_received = $3`
  }
  const { rows } = await client.query<IntakeMatch>(sql, params)
  return rows
}

async function applyDeliveryTarget(
  client: pg.PoolClient,
  action: Extract<SystemCorrectAction, { kind: 'delivery_target' }>,
  spintexId: string,
  apply: boolean
): Promise<string> {
  const { rows: chain } = await client.query<{
    received: number
    delivered: number
    sold: number
    returned: number
    inventory: number
  }>(
    `
    WITH r AS (
      SELECT COALESCE(SUM(quantity_received),0)::int q FROM intakes
      WHERE deleted_at IS NULL AND product_id = $1::uuid
    ),
    d AS (
      SELECT COALESCE(SUM(dri.quantity_delivered),0)::int q
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid
    ),
    s AS (
      SELECT COALESCE(SUM(qty_sold),0)::int q FROM sales
      WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid
    ),
    ret AS (
      SELECT COALESCE(SUM(quantity_returned),0)::int q FROM product_returns
      WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid
    ),
    inv AS (
      SELECT COALESCE(quantity,0)::int q FROM supermarket_inventory
      WHERE product_id = $1::uuid AND supermarket_id = $2::uuid
    )
    SELECT r.q AS received, d.q AS delivered, s.q AS sold, ret.q AS returned,
           COALESCE((SELECT q FROM inv), 0) AS inventory
    FROM r, d, s, ret
    `,
    [action.product.product_id, spintexId]
  )
  const c = chain[0]
  if (!c) return `${describe(action)} — chain query failed`
  if (c.delivered === action.deliveredTotal) {
    return `${describe(action)} — already delivered=${action.deliveredTotal}`
  }

  const targetInv = Math.max(0, action.deliveredTotal - c.sold - c.returned)
  if (!apply) {
    return `${describe(action)} — would replace deliveries ${c.delivered}→${action.deliveredTotal}, shelf ${c.inventory}→${targetInv}`
  }

  const { rows: runs } = await client.query<{ delivery_run_id: string }>(
    `SELECT DISTINCT dr.id AS delivery_run_id
     FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
     WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid`,
    [action.product.product_id, spintexId]
  )
  for (const run of runs) {
    await client.query(
      `UPDATE delivery_runs SET deleted_at = now(), notes = COALESCE(notes,'') || ' [${SYSTEM_CORRECT_REF}]'
       WHERE id = $1::uuid AND deleted_at IS NULL`,
      [run.delivery_run_id]
    )
  }

  const { rows: newRun } = await client.query<{ id: string }>(
    `INSERT INTO delivery_runs (supermarket_id, delivery_date, total_transport_cost, notes, source, destination_type)
     VALUES ($1::uuid, CURRENT_DATE, NULL, $2, 'HISTORICAL_MIGRATION', 'BRANCH')
     RETURNING id`,
    [spintexId, `${SYSTEM_CORRECT_REF}:delivery-target`]
  )
  await client.query(
    `INSERT INTO delivery_run_items (delivery_run_id, product_id, quantity_delivered)
     VALUES ($1::uuid, $2::uuid, $3)`,
    [newRun[0].id, action.product.product_id, action.deliveredTotal]
  )
  await confirmHistoricalDeliveryRun(client, {
    deliveryRunId: newRun[0].id,
    supermarketId: spintexId,
  })

  const { rows: inv } = await client.query<{ id: string }>(
    `SELECT id FROM supermarket_inventory WHERE supermarket_id = $1::uuid AND product_id = $2::uuid FOR UPDATE`,
    [spintexId, action.product.product_id]
  )
  if (inv[0]) {
    await client.query(`UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`, [
      inv[0].id,
      targetInv,
    ])
  } else if (targetInv > 0) {
    await client.query(
      `INSERT INTO supermarket_inventory (supermarket_id, product_id, quantity) VALUES ($1::uuid, $2::uuid, $3)`,
      [spintexId, action.product.product_id, targetInv]
    )
  }

  return `${describe(action)} — applied delivery ${c.delivered}→${action.deliveredTotal}, shelf→${targetInv}`
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

  const rows = await loadSystemCorrectRows(filePath)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const { actions, unresolved, skipped: parseSkipped } = await buildSystemCorrectPlan(pool, rows)

  console.log(`=== System correct workbook (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('File:', filePath)
  console.log('Rows:', rows.length)
  console.log(
    'Actions:',
    actions.length,
    `(delete ${actions.filter((a) => a.kind === 'delete').length}, date ${actions.filter((a) => a.kind === 'update_date').length}, qty ${actions.filter((a) => a.kind === 'update_qty').length}, insert ${actions.filter((a) => a.kind === 'insert').length}, delivery ${actions.filter((a) => a.kind === 'delivery_target').length})`
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

  try {
    if (APPLY) await client.query('BEGIN')

    for (const action of actions) {
      const label = describe(action)

      if (action.kind === 'delete') {
        const matches = await findIntakesForDelete(client, action)
        if (!matches.length) {
          skipped.push(`${label} — no matching intake (may already be deleted)`)
          continue
        }
        if (APPLY) {
          for (const m of matches) {
            await client.query(
              `UPDATE intakes SET deleted_at = now(),
               reference = COALESCE(NULLIF(reference, ''), $2)
               WHERE id = $1::uuid AND deleted_at IS NULL`,
              [m.id, SYSTEM_CORRECT_REF]
            )
          }
        }
        applied.push(`${label} → ${APPLY ? 'deleted' : 'would delete'} ${matches.length} intake(s)`)
        continue
      }

      if (action.kind === 'insert') {
        const { rows: dup } = await client.query<{ id: string }>(
          `SELECT id FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid
           AND received_date = $2::date AND quantity_received = $3 LIMIT 1`,
          [action.product.product_id, action.receivedDate, action.qty]
        )
        if (dup.length) {
          skipped.push(`${label} — already exists (${dup[0].id})`)
          continue
        }
        if (APPLY) {
          await client.query(
            `INSERT INTO intakes (vendor_id, product_id, quantity_received, received_date, reference)
             VALUES ($1::uuid, $2::uuid, $3, $4::date, $5)`,
            [
              action.product.vendor_id,
              action.product.product_id,
              action.qty,
              action.receivedDate,
              SYSTEM_CORRECT_REF,
            ]
          )
        }
        applied.push(`${label} → ${APPLY ? 'inserted' : 'would insert'}`)
        continue
      }

      if (action.kind === 'update_date') {
        const matches = await findIntakesByDateQty(
          client,
          action.product.product_id,
          action.fromDate,
          action.matchQty
        )
        if (!matches.length) {
          skipped.push(`${label} — no intake on ${action.fromDate}`)
          continue
        }
        for (const m of matches) {
          if (m.received_date.startsWith(action.toDate) && (action.toQty == null || m.quantity_received === action.toQty)) {
            skipped.push(`${label} — already ${action.toDate}×${action.toQty ?? m.quantity_received} (${m.id})`)
            continue
          }
          if (APPLY) {
            if (action.toQty != null) {
              await client.query(
                `UPDATE intakes SET received_date = $1::date, quantity_received = $2 WHERE id = $3::uuid AND deleted_at IS NULL`,
                [action.toDate, action.toQty, m.id]
              )
            } else {
              await client.query(
                `UPDATE intakes SET received_date = $1::date WHERE id = $2::uuid AND deleted_at IS NULL`,
                [action.toDate, m.id]
              )
            }
          }
          applied.push(
            `${label} → ${APPLY ? 'updated' : 'would update'} ${m.id} (${m.received_date.slice(0, 10)}×${m.quantity_received})`
          )
        }
        continue
      }

      if (action.kind === 'update_qty') {
        const dateFix = {
          kind: 'update_qty' as const,
          sourceRows: action.sourceRows,
          product: action.product,
          fromQty: action.fromQty,
          toQty: action.toQty,
          onDate: action.onDate,
        }
        const matches = await findIntakesForAction(client, dateFix)
        if (!matches.length) {
          skipped.push(`${label} — no intake qty=${action.fromQty}`)
          continue
        }
        const target = matches[0]
        if (target.quantity_received === action.toQty) {
          skipped.push(`${label} — already qty=${action.toQty}`)
          continue
        }
        if (APPLY) {
          await client.query(
            `UPDATE intakes SET quantity_received = $1 WHERE id = $2::uuid AND deleted_at IS NULL`,
            [action.toQty, target.id]
          )
        }
        applied.push(`${label} → ${APPLY ? 'updated' : 'would update'} ${target.id}`)
        continue
      }

      if (action.kind === 'delivery_target') {
        applied.push(await applyDeliveryTarget(client, action, spintexId, APPLY))
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
