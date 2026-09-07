/**
 * Apply admin intake corrections from chronology fix admin.xlsx.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/apply-admin-intake-corrections.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-admin-intake-corrections.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'
import {
  ADMIN_CORRECTION_REF,
  ADMIN_INTAKE_FILE,
  buildIntakeCorrectionPlan,
  findIntakesForAction,
  loadAdminIntakeRows,
  type IntakeCorrectionAction,
} from '@/lib/migration/admin-intake-corrections'

const APPLY = process.argv.includes('--apply')

function describeAction(action: IntakeCorrectionAction): string {
  const rows = `R${action.sourceRows.join(',R')}`
  const name = action.product.product_name.slice(0, 45)
  switch (action.kind) {
    case 'update_date':
      return `${rows} date ${action.fromDate}→${action.toDate}${action.toQty != null ? ` qty→${action.toQty}` : ''} | ${name}`
    case 'update_qty':
      return `${rows} qty ${action.fromQty}→${action.toQty}${action.onDate ? ` on ${action.onDate}` : ''} | ${name}`
    case 'insert':
      return `${rows} NEW intake qty=${action.qty} date=${action.receivedDate} | ${name}`
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

  const adminRows = await loadAdminIntakeRows()
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { actions, unresolved } = await buildIntakeCorrectionPlan(pool, adminRows)

  console.log(`=== Admin intake corrections (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('File:', ADMIN_INTAKE_FILE)
  console.log('Parsed rows:', adminRows.length)
  console.log('Planned actions:', actions.length, `(date ${actions.filter((a) => a.kind === 'update_date').length}, qty ${actions.filter((a) => a.kind === 'update_qty').length}, new ${actions.filter((a) => a.kind === 'insert').length})`)

  if (unresolved.length) {
    console.log('\n=== UNRESOLVED ===')
    unresolved.forEach((u) => console.log(u))
  }

  const client = await pool.connect()
  let dateUpdates = 0
  let qtyUpdates = 0
  let inserts = 0
  const skipped: string[] = []
  const applied: string[] = []

  try {
    if (APPLY) await client.query('BEGIN')

    for (const action of actions) {
      const label = describeAction(action)

      if (action.kind === 'insert') {
        const { rows: dup } = await client.query<{ id: string }>(
          `SELECT id FROM intakes
           WHERE deleted_at IS NULL AND product_id = $1::uuid
             AND received_date = $2::date AND quantity_received = $3
           LIMIT 1`,
          [action.product.product_id, action.receivedDate, action.qty]
        )
        if (dup.length) {
          skipped.push(`${label} — already exists (${dup[0].id})`)
          continue
        }

        if (APPLY) {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO intakes (vendor_id, product_id, quantity_received, received_date, reference)
             VALUES ($1::uuid, $2::uuid, $3, $4::date, $5)
             RETURNING id`,
            [
              action.product.vendor_id,
              action.product.product_id,
              action.qty,
              action.receivedDate,
              ADMIN_CORRECTION_REF,
            ]
          )
          inserts++
          applied.push(`${label} → inserted ${ins.rows[0].id}`)
        } else {
          applied.push(`${label} → would insert`)
          inserts++
        }
        continue
      }

      const matches = await findIntakesForAction(client, action)
      if (!matches.length && action.kind === 'update_qty' && action.onDate) {
        const { rows: onDate } = await client.query<IntakeMatch>(
          `SELECT id, received_date::text, quantity_received
           FROM intakes
           WHERE deleted_at IS NULL AND product_id = $1::uuid AND received_date = $2::date
           ORDER BY received_date, quantity_received`,
          [action.product.product_id, action.onDate]
        )
        if (onDate.length === 1 && onDate[0].quantity_received === action.toQty) {
          skipped.push(`${label} — already ${action.onDate}×${action.toQty} (${onDate[0].id})`)
          continue
        }
      }
      if (!matches.length) {
        skipped.push(`${label} — no matching intake`)
        continue
      }

      if (action.kind === 'update_date') {
        for (const m of matches) {
          if (action.toQty != null && m.quantity_received === action.toQty && m.received_date.startsWith(action.toDate)) {
            skipped.push(`${label} — already ${action.toDate}×${action.toQty} (${m.id})`)
            continue
          }
          if (APPLY) {
            if (action.toQty != null) {
              await client.query(
                `UPDATE intakes SET received_date = $1::date, quantity_received = $2
                 WHERE id = $3::uuid AND deleted_at IS NULL`,
                [action.toDate, action.toQty, m.id]
              )
            } else {
              await client.query(
                `UPDATE intakes SET received_date = $1::date
                 WHERE id = $2::uuid AND deleted_at IS NULL`,
                [action.toDate, m.id]
              )
            }
          }
          dateUpdates++
          applied.push(
            `${label} → ${APPLY ? 'updated' : 'would update'} ${m.id} (${m.received_date.slice(0, 10)}×${m.quantity_received}${action.toQty != null ? ` → ${action.toDate}×${action.toQty}` : ''})`
          )
        }
        continue
      }

      // update_qty
      const target = matches.find((m) => m.quantity_received === action.fromQty) ?? matches[0]
      if (target.quantity_received === action.toQty) {
        skipped.push(`${label} — already qty=${action.toQty} (${target.id})`)
        continue
      }
      if (APPLY) {
        await client.query(
          `UPDATE intakes SET quantity_received = $1
           WHERE id = $2::uuid AND deleted_at IS NULL`,
          [action.toQty, target.id]
        )
      }
      qtyUpdates++
      applied.push(
        `${label} → ${APPLY ? 'updated' : 'would update'} ${target.id} (${target.received_date.slice(0, 10)}×${target.quantity_received})`
      )
      if (matches.length > 1) {
        skipped.push(`${label} — ${matches.length - 1} additional intake(s) with qty=${action.fromQty} left unchanged`)
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
    console.log('\n=== SKIPPED / WARNINGS ===')
    skipped.forEach((l) => console.log(l))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Date updates: ${dateUpdates}`)
  console.log(`Qty updates: ${qtyUpdates}`)
  console.log(`New intakes: ${inserts}`)
  console.log(`Skipped: ${skipped.length}`)
  if (!APPLY) console.log('\nRe-run with --apply to commit changes.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
