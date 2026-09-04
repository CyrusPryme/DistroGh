/**
 * Check deliveries maiden import outcome + operational deliveries table.
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const MIGRATION_ID = '0c448e7b-f14c-4469-8e4d-48b8809f81db'

async function main() {
  const project = await pool.query(
    `SELECT id, name, status, current_stage, progress_pct, validation_status,
            reconciliation, preview_summary, error_summary, completed_at
     FROM migration_projects WHERE id = $1`,
    [MIGRATION_ID]
  )
  console.log('PROJECT:', project.rows[0])

  const staging = await pool.query(
    `SELECT validation_status, production_id IS NOT NULL AS imported, COUNT(*)::int c
     FROM migration_staging_rows WHERE migration_id = $1
     GROUP BY validation_status, (production_id IS NOT NULL)`,
    [MIGRATION_ID]
  )
  console.log('\nSTAGING:', staging.rows)

  const jobs = await pool.query(
    `SELECT job_type, status, progress_pct, error_message, result_summary, completed_at
     FROM migration_jobs WHERE migration_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [MIGRATION_ID]
  )
  console.log('\nJOBS:')
  jobs.rows.forEach((j) =>
    console.log(`  ${j.job_type} ${j.status} ${j.progress_pct}%`, j.error_message ?? '', j.result_summary ?? '')
  )

  const phase = await pool.query(
    `SELECT * FROM migration_phase_results WHERE migration_id = $1`,
    [MIGRATION_ID]
  )
  console.log('\nPHASE RESULTS:', phase.rows)

  const runs = await pool.query(
    `SELECT COUNT(*)::int c, MIN(delivery_date) min_d, MAX(delivery_date) max_d
     FROM delivery_runs WHERE deleted_at IS NULL`
  )
  console.log('\nALL delivery_runs:', runs.rows[0])

  const items = await pool.query(
    `SELECT COUNT(*)::int c FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id
     WHERE dr.deleted_at IS NULL`
  )
  console.log('ALL delivery_run_items:', items.rows[0])

  const migrated = await pool.query(
    `SELECT COUNT(*)::int c FROM delivery_runs
     WHERE migration_id = $1 AND deleted_at IS NULL`,
    [MIGRATION_ID]
  )
  console.log('Runs from this migration:', migrated.rows[0])

  const sample = await pool.query(
    `SELECT dr.id, dr.delivery_date, dr.supermarket_id, dr.destination_type,
            dr.destination_reference, dr.notes, s.name, s.branch,
            COUNT(dri.id)::int items
     FROM delivery_runs dr
     LEFT JOIN supermarkets s ON s.id = dr.supermarket_id
     LEFT JOIN delivery_run_items dri ON dri.delivery_run_id = dr.id
     WHERE dr.migration_id = $1 AND dr.deleted_at IS NULL
     GROUP BY dr.id, s.name, s.branch
     ORDER BY dr.delivery_date DESC LIMIT 5`,
    [MIGRATION_ID]
  )
  console.log('\nSample migrated runs:', sample.rows)

  const recent = await pool.query(
    `SELECT dr.id, dr.delivery_date, dr.destination_type, s.name, s.branch,
            COUNT(dri.id)::int items
     FROM delivery_runs dr
     LEFT JOIN supermarkets s ON s.id = dr.supermarket_id
     LEFT JOIN delivery_run_items dri ON dri.delivery_run_id = dr.id
     WHERE dr.deleted_at IS NULL
     GROUP BY dr.id, s.name, s.branch
     ORDER BY dr.created_at DESC LIMIT 5`
  )
  console.log('\nMost recent delivery runs (any source):', recent.rows)

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
