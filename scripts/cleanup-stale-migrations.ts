/**
 * Remove failed/stale migration wizard projects that never imported production data.
 * Migrations with staging production_id are kept (optionally marked completed if stuck).
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/cleanup-stale-migrations.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/cleanup-stale-migrations.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

type Row = {
  id: string
  name: string
  status: string
  imported: number
  deliveries: number
}

async function loadCandidates(): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT mp.id, mp.name, mp.status,
            COALESCE(s.imported, 0)::int AS imported,
            COALESCE(d.deliveries, 0)::int AS deliveries
     FROM migration_projects mp
     LEFT JOIN (
       SELECT migration_id, COUNT(*) FILTER (WHERE production_id IS NOT NULL)::int AS imported
       FROM migration_staging_rows GROUP BY migration_id
     ) s ON s.migration_id = mp.id
     LEFT JOIN (
       SELECT migration_id, COUNT(*)::int AS deliveries
       FROM delivery_runs WHERE deleted_at IS NULL AND migration_id IS NOT NULL
       GROUP BY migration_id
     ) d ON d.migration_id = mp.id
     WHERE mp.status <> 'completed'
     ORDER BY mp.created_at DESC`
  )
  return rows
}

async function main() {
  const rows = await loadCandidates()
  const toDelete = rows.filter((r) => r.imported === 0 && r.deliveries === 0)
  const toComplete = rows.filter((r) => r.imported > 0 && r.status !== 'completed')

  console.log(`=== Stale migration cleanup (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
  console.log('Non-completed projects:', rows.length)
  console.log('Delete (no production imports):', toDelete.length)
  console.log('Mark completed (imported but stuck status):', toComplete.length)

  console.log('\n--- WILL DELETE ---')
  toDelete.forEach((r) => console.log(`  [${r.status}] ${r.name} (${r.id})`))

  console.log('\n--- WILL MARK COMPLETED (keep audit trail) ---')
  toComplete.forEach((r) => console.log(`  [${r.status}] ${r.name} — ${r.imported} imported (${r.id})`))

  console.log('\n--- KEEP UNCHANGED ---')
  rows
    .filter((r) => !toDelete.includes(r) && !toComplete.includes(r))
    .forEach((r) => console.log(`  [${r.status}] ${r.name} (${r.id})`))

  if (!APPLY) {
    console.log('\nRe-run with --apply to execute.')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const r of toDelete) {
      await client.query(
        `UPDATE migration_jobs SET status = 'cancelled', error_message = COALESCE(error_message, 'Stale migration cleanup')
         WHERE migration_id = $1::uuid AND status IN ('queued', 'running')`,
        [r.id]
      )
      await client.query(`DELETE FROM migration_projects WHERE id = $1::uuid`, [r.id])
      console.log('Deleted:', r.name)
    }

    for (const r of toComplete) {
      const { rows: byEntity } = await client.query<{
        entity_type: string
        total: number
        imported: number
      }>(
        `SELECT entity_type, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE production_id IS NOT NULL)::int AS imported
         FROM migration_staging_rows WHERE migration_id = $1::uuid GROUP BY entity_type`,
        [r.id]
      )
      const reconciliation: Record<string, unknown> = {}
      for (const e of byEntity) {
        reconciliation[e.entity_type] = {
          total: e.total,
          expected: e.total,
          imported: e.imported,
          status: e.imported === e.total ? 'balanced' : 'mismatch',
        }
      }
      await client.query(
        `UPDATE migration_projects
         SET status = 'completed', progress_pct = 100, current_stage = 10,
             completed_at = COALESCE(completed_at, now()),
             reconciliation = $2::jsonb
         WHERE id = $1::uuid`,
        [r.id, JSON.stringify(reconciliation)]
      )
      console.log('Marked completed:', r.name)
    }

    await client.query('COMMIT')
    console.log('\nDone.')
  } catch (e) {
    await client.query('ROLLBACK')
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
