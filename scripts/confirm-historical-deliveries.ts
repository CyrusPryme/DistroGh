/**
 * Confirm historical delivery runs from a migration + fix project reconciliation.
 * Usage: npx tsx -r dotenv/config scripts/confirm-historical-deliveries.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { confirmHistoricalDeliveryRun } from '@/lib/migration/historical-delivery-confirm'
import { updateMigrationProject } from '@/lib/migration/projects'

const MIGRATION_ID = '0c448e7b-f14c-4469-8e4d-48b8809f81db'

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: runs } = await pool.query(
    `SELECT id, supermarket_id FROM delivery_runs
     WHERE migration_id = $1 AND deleted_at IS NULL AND confirmed_at IS NULL AND supermarket_id IS NOT NULL`,
    [MIGRATION_ID]
  )
  console.log('Unconfirmed historical runs to confirm:', runs.length)

  const client = await pool.connect()
  let confirmed = 0
  try {
    await client.query('BEGIN')
    for (const run of runs) {
      await confirmHistoricalDeliveryRun(client, {
        deliveryRunId: run.id,
        supermarketId: run.supermarket_id,
      })
      confirmed++
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  console.log('Confirmed:', confirmed)

  const { rows: reconRows } = await pool.query(
    `SELECT entity_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE validation_status IN ('valid','warning','corrected'))::int AS expected,
            COUNT(*) FILTER (WHERE production_id IS NOT NULL)::int AS imported
     FROM migration_staging_rows
     WHERE migration_id = $1
     GROUP BY entity_type`,
    [MIGRATION_ID]
  )

  const reconciliation: Record<string, unknown> = {}
  let allBalanced = reconRows.length > 0
  for (const r of reconRows) {
    const status = r.expected === r.imported ? 'balanced' : 'mismatch'
    if (status !== 'balanced') allBalanced = false
    reconciliation[r.entity_type] = {
      total: r.total,
      expected: r.expected,
      imported: r.imported,
      status,
    }
  }

  await updateMigrationProject(pool, MIGRATION_ID, {
    reconciliation,
    status: allBalanced ? 'completed' : 'verifying',
    current_stage: allBalanced ? 10 : 9,
    progress_pct: allBalanced ? 100 : 95,
    completed_at: allBalanced ? new Date().toISOString() : null,
    wizard_state: { stage: allBalanced ? 10 : 9, reconciled_at: new Date().toISOString() },
  })

  console.log('Reconciliation:', reconciliation)
  console.log('Migration status:', allBalanced ? 'completed' : 'verifying')

  const inv = await pool.query(
    `SELECT COUNT(*)::int c, SUM(quantity)::int units
     FROM supermarket_inventory si
     JOIN delivery_runs dr ON dr.supermarket_id = si.supermarket_id
     WHERE dr.migration_id = $1 AND dr.deleted_at IS NULL`,
    [MIGRATION_ID]
  )
  console.log('Store inventory rows linked to migration supermarket:', inv.rows[0])

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
