/**
 * Revert a SYSTEM CORRECT workbook apply (inverse intakes + restore soft-deleted delivery runs).
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/revert-system-correct-workbook.ts dotenv_config_path=.env.local --file "discrepancies fix/SYSTEM CORRECT FARMER TORKS 4.xlsx"
 *   npx tsx -r dotenv/config scripts/revert-system-correct-workbook.ts dotenv_config_path=.env.local --file "discrepancies fix/SYSTEM CORRECT FARMER TORKS 4.xlsx" --apply
 */
import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'
import { findIntakesForAction } from '@/lib/migration/admin-intake-corrections'
import {
  buildSystemCorrectPlan,
  loadSystemCorrectRows,
  SYSTEM_CORRECT_FILE_4,
  systemCorrectRefForPath,
  type SystemCorrectAction,
} from '@/lib/migration/system-correct-workbook'

const APPLY = process.argv.includes('--apply')
const fileArgIdx = process.argv.indexOf('--file')
const filePath = fileArgIdx >= 0 ? process.argv[fileArgIdx + 1]! : SYSTEM_CORRECT_FILE_4

function invertIntakeActions(actions: SystemCorrectAction[]): SystemCorrectAction[] {
  const out: SystemCorrectAction[] = []
  for (const a of actions) {
    if (a.kind === 'update_date') {
      out.push({
        kind: 'update_date',
        sourceRows: a.sourceRows,
        product: a.product,
        fromDate: a.toDate,
        toDate: a.fromDate,
        matchQty: a.toQty ?? a.matchQty,
        toQty: a.matchQty,
        limitMatches: a.limitMatches,
      })
    } else if (a.kind === 'update_qty') {
      out.push({
        kind: 'update_qty',
        sourceRows: a.sourceRows,
        product: a.product,
        fromQty: a.toQty,
        toQty: a.fromQty,
        onDate: a.onDate,
      })
    } else if (a.kind === 'delete') {
      out.push(a)
    }
  }
  return out.reverse()
}

async function findIntakesByDateQty(
  client: pg.PoolClient,
  productId: string,
  onDate: string,
  matchQty?: number
) {
  const params: unknown[] = [productId, onDate]
  let sql = `SELECT id, received_date::text, quantity_received FROM intakes
             WHERE deleted_at IS NULL AND product_id = $1::uuid AND received_date = $2::date`
  if (matchQty != null) {
    params.push(matchQty)
    sql += ` AND quantity_received = $3`
  }
  const { rows } = await client.query<{ id: string; received_date: string; quantity_received: number }>(sql, params)
  return rows
}

async function recomputeSpintexShelf(
  client: pg.PoolClient,
  productId: string,
  spintexId: string,
  apply: boolean
): Promise<string> {
  const { rows } = await client.query<{ delivered: number; sold: number; returned: number }>(
    `
    WITH d AS (
      SELECT COALESCE(SUM(dri.quantity_delivered),0)::int q
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid
    ),
    s AS (
      SELECT COALESCE(SUM(qty_sold),0)::int q FROM sales
      WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid
    ),
    r AS (
      SELECT COALESCE(SUM(quantity_returned),0)::int q FROM product_returns
      WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid
    )
    SELECT d.q AS delivered, s.q AS sold, r.q AS returned FROM d, s, r
    `,
    [productId, spintexId]
  )
  const c = rows[0] ?? { delivered: 0, sold: 0, returned: 0 }
  const target = Math.max(0, c.delivered - c.sold + c.returned)
  if (apply) {
    const { rows: inv } = await client.query<{ id: string }>(
      `SELECT id FROM supermarket_inventory WHERE supermarket_id = $1::uuid AND product_id = $2::uuid FOR UPDATE`,
      [spintexId, productId]
    )
    if (inv[0]) {
      await client.query(`UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`, [
        inv[0].id,
        target,
      ])
    } else if (target > 0) {
      await client.query(
        `INSERT INTO supermarket_inventory (supermarket_id, product_id, quantity) VALUES ($1::uuid, $2::uuid, $3)`,
        [spintexId, productId, target]
      )
    }
  }
  return `shelf→${target} (del ${c.delivered}, sold ${c.sold}, ret ${c.returned})`
}

async function revertDeliveriesForRef(
  client: pg.PoolClient,
  correctionRef: string,
  spintexId: string,
  productIds: string[],
  apply: boolean
): Promise<string[]> {
  const lines: string[] = []
  const tag = `[${correctionRef}]`
  const newNote = `${correctionRef}:delivery-target`

  const { rows: newRuns } = await client.query<{ id: string; product_id: string; qty: number }>(
    `
    SELECT dr.id, dri.product_id, dri.quantity_delivered AS qty
    FROM delivery_runs dr
    JOIN delivery_run_items dri ON dri.delivery_run_id = dr.id
    WHERE dr.deleted_at IS NULL
      AND dr.supermarket_id = $1::uuid
      AND dr.notes = $2
      AND dri.product_id = ANY($3::uuid[])
    `,
    [spintexId, newNote, productIds]
  )

  for (const run of newRuns) {
    lines.push(
      `${apply ? 'Remove' : 'Would remove'} batch run ${run.id.slice(0, 8)}… product ${run.product_id.slice(0, 8)} qty ${run.qty}`
    )
    if (apply) {
      await client.query(`UPDATE delivery_runs SET deleted_at = now() WHERE id = $1::uuid AND deleted_at IS NULL`, [
        run.id,
      ])
    }
  }

  const { rows: oldRuns } = await client.query<{ id: string }>(
    `
    SELECT DISTINCT dr.id
    FROM delivery_runs dr
    JOIN delivery_run_items dri ON dri.delivery_run_id = dr.id
    WHERE dr.deleted_at IS NOT NULL
      AND dr.supermarket_id = $1::uuid
      AND dr.notes LIKE '%' || $2 || '%'
      AND dri.product_id = ANY($3::uuid[])
    `,
    [spintexId, tag, productIds]
  )

  for (const run of oldRuns) {
    lines.push(`${apply ? 'Restore' : 'Would restore'} prior run ${run.id.slice(0, 8)}…`)
    if (apply) {
      await client.query(`UPDATE delivery_runs SET deleted_at = NULL WHERE id = $1::uuid`, [run.id])
    }
  }

  return lines
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

  const correctionRef = systemCorrectRefForPath(filePath)
  const rows = await loadSystemCorrectRows(filePath)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const { actions } = await buildSystemCorrectPlan(pool, rows)
  const deliveryProducts = actions
    .filter((a): a is Extract<SystemCorrectAction, { kind: 'delivery_target' }> => a.kind === 'delivery_target')
    .map((a) => a.product.product_id)
  const inverted = invertIntakeActions(actions.filter((a) => a.kind !== 'delivery_target'))

  console.log(`=== Revert SYSTEM CORRECT (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('File:', filePath)
  console.log('Reference:', correctionRef)

  const client = await pool.connect()
  const log: string[] = []

  try {
    if (APPLY) await client.query('BEGIN')

    const deliveryLines = await revertDeliveriesForRef(
      client,
      correctionRef,
      spintexId,
      deliveryProducts,
      APPLY
    )
    log.push(...deliveryLines)

    for (const productId of deliveryProducts) {
      log.push(
        `Inventory ${productId.slice(0, 8)}… ${await recomputeSpintexShelf(client, productId, spintexId, APPLY)}`
      )
    }

    for (const action of inverted) {
      if (action.kind === 'delete') {
        const params: unknown[] = [action.product.product_id, action.onDate]
        let sql = `SELECT id FROM intakes WHERE deleted_at IS NOT NULL AND product_id = $1::uuid AND received_date = $2::date`
        if (action.matchQty != null) {
          params.push(action.matchQty)
          sql += ` AND quantity_received = $3`
        }
        const { rows: deleted } = await client.query<{ id: string }>(sql, params)
        for (const d of deleted) {
          log.push(`${APPLY ? 'Restore' : 'Would restore'} intake ${d.id} (${action.onDate})`)
          if (APPLY) {
            await client.query(`UPDATE intakes SET deleted_at = NULL WHERE id = $1::uuid`, [d.id])
          }
        }
        continue
      }

      if (action.kind === 'update_date') {
        const matches = await findIntakesByDateQty(
          client,
          action.product.product_id,
          action.fromDate,
          action.matchQty
        )
        const toUpdate =
          action.limitMatches != null ? matches.slice(0, action.limitMatches) : matches
        for (const m of toUpdate) {
          log.push(
            `${APPLY ? 'Revert' : 'Would revert'} intake ${m.id}: ${action.fromDate}×${m.quantity_received} → ${action.toDate}×${action.toQty ?? m.quantity_received}`
          )
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
        }
        continue
      }

      if (action.kind === 'update_qty') {
        const matches = await findIntakesForAction(client, action)
        if (!matches[0]) {
          log.push(`Skip qty revert — no intake qty=${action.fromQty}`)
          continue
        }
        const target = matches[0]
        log.push(`${APPLY ? 'Revert' : 'Would revert'} qty ${target.id}: ${action.fromQty}→${action.toQty}`)
        if (APPLY) {
          await client.query(
            `UPDATE intakes SET quantity_received = $1 WHERE id = $2::uuid AND deleted_at IS NULL`,
            [action.toQty, target.id]
          )
        }
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

  log.forEach((l) => console.log(' ', l))
  if (!APPLY) console.log('\nRe-run with --apply to commit.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
