/**
 * Recover deliveries maiden when parse job stuck and staging is empty.
 *
 * Usage: npx tsx -r dotenv/config scripts/recover-deliveries-parse.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { parseAllActiveFiles } from '@/lib/migration/parse'
import { validateMigrationStaging } from '@/lib/migration/validate'
import { getFileBlob } from '@/lib/migration/files'
import { parseWorkbook } from '@/lib/migration/parse'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const { rows: projects } = await pool.query(
    `SELECT id, name FROM migration_projects
     WHERE lower(name) = 'deliveries maiden'
     ORDER BY created_at DESC LIMIT 1`
  )
  if (!projects[0]) throw new Error('deliveries maiden project not found')
  const migrationId = projects[0].id as string
  console.log('Recovering:', projects[0].name, migrationId)

  const { rows: activeFiles } = await pool.query(
    `SELECT id, original_filename, parse_status, row_count FROM migration_files
     WHERE migration_id = $1 AND is_active = true`,
    [migrationId]
  )
  console.log('Active files before:', activeFiles)

  for (const f of activeFiles) {
    const blob = await getFileBlob(pool, f.id)
    if (!blob) {
      console.log('WARNING: no blob for', f.original_filename)
      continue
    }
    const parsed = await parseWorkbook(blob)
    console.log(`Local parse of blob "${f.original_filename}": ${parsed.rows.length} rows`)
  }

  const stuck = await pool.query(
    `UPDATE migration_jobs
     SET status = 'cancelled',
         error_message = 'Recovery script: cleared stuck job',
         completed_at = now(),
         updated_at = now()
     WHERE migration_id = $1
       AND job_type = 'parse'
       AND status IN ('queued', 'running')
     RETURNING id, status`,
    [migrationId]
  )
  console.log('Cancelled stuck parse jobs:', stuck.rows)

  await pool.query(
    `UPDATE migration_files
     SET parse_status = 'pending', parse_error = NULL, row_count = 0
     WHERE migration_id = $1 AND is_active = true AND parse_status IN ('parsing', 'failed')`,
    [migrationId]
  )

  console.log('\nRe-parsing active files...')
  const parseResult = await parseAllActiveFiles(pool, migrationId)
  console.log('Parse result:', parseResult)

  const staging = await pool.query(
    `SELECT validation_status, COUNT(*)::int c
     FROM migration_staging_rows WHERE migration_id = $1
     GROUP BY validation_status`,
    [migrationId]
  )
  console.log('Staging after parse:', staging.rows)

  console.log('\nRe-validating...')
  const validation = await validateMigrationStaging(pool, migrationId)
  console.log('Validation:', validation)

  const eligible = await pool.query(
    `SELECT COUNT(*)::int c FROM migration_staging_rows
     WHERE migration_id = $1
       AND production_id IS NULL
       AND intended_action <> 'skip'
       AND validation_status IN ('valid', 'warning', 'corrected')`,
    [migrationId]
  )
  console.log('\nEligible for import:', eligible.rows[0].c)

  const errors = await pool.query(
    `SELECT jsonb_array_elements(errors)->>'code' AS code, COUNT(*)::int c
     FROM migration_staging_rows
     WHERE migration_id = $1 AND validation_status = 'error'
     GROUP BY 1 ORDER BY c DESC`,
    [migrationId]
  )
  if (errors.rows.length) console.log('Error breakdown:', errors.rows)

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
