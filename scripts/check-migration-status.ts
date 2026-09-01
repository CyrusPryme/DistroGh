import pg from 'pg'

const id = process.argv[2] ?? '3a956237-0c05-4bbb-927a-7cf3d1355d0b'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const p = await pool.query(
    `SELECT status, error_count, reconciliation, progress_pct FROM migration_projects WHERE id = $1`,
    [id]
  )
  console.log('Project:', p.rows[0])
  const jobs = await pool.query(
    `SELECT job_type, entity_type, status, progress_pct, current_record, total_records, error_message
     FROM migration_jobs WHERE migration_id = $1 ORDER BY created_at`,
    [id]
  )
  console.log('Jobs:', jobs.rows)
  const imported = await pool.query(
    `SELECT COUNT(*)::int AS c FROM migration_staging_rows WHERE migration_id = $1 AND production_id IS NOT NULL`,
    [id]
  )
  console.log('Imported staging rows:', imported.rows[0].c)
  await pool.end()
}

main().catch(console.error)
