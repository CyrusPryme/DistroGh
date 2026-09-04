/**
 * Inspect stuck parse job for deliveries maiden.
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const MIGRATION_ID = '0c448e7b-f14c-4469-8e4d-48b8809f81db'

async function main() {
  const jobs = await pool.query(
    `SELECT id, job_type, status, progress_pct, total_records,
            error_message, started_at, completed_at, created_at, payload
     FROM migration_jobs
     WHERE migration_id = $1
     ORDER BY created_at DESC`,
    [MIGRATION_ID]
  )
  console.log('ALL JOBS:')
  for (const j of jobs.rows) {
    console.log(JSON.stringify(j, null, 2))
  }

  const files = await pool.query(
    `SELECT id, original_filename, parse_status, parse_error, row_count, blob_size, is_active, uploaded_at
     FROM migration_files WHERE migration_id = $1 ORDER BY uploaded_at DESC`,
    [MIGRATION_ID]
  )
  console.log('\nFILES:')
  for (const f of files.rows) {
    console.log(JSON.stringify(f))
    const hasBlob = await pool.query(
      `SELECT length(blob) AS len FROM migration_file_blobs WHERE file_id = $1`,
      [f.id]
    )
    console.log('  blob bytes:', hasBlob.rows[0]?.len ?? 'MISSING')
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
