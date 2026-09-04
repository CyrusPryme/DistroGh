/**
 * Diagnose why deliveries migration import is blocked.
 * Usage: npx tsx -r dotenv/config scripts/diagnose-deliveries-import.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const { rows: projects } = await pool.query(
    `SELECT id, name, status, current_stage, validation_status, error_count, warning_count,
            wizard_state, error_summary, last_validated_at
     FROM migration_projects
     WHERE lower(name) LIKE '%deliver%maiden%' OR lower(name) LIKE '%deliveries maiden%'
     ORDER BY created_at DESC
     LIMIT 3`
  )

  if (!projects.length) {
    console.log('No deliveries maiden project found')
    await pool.end()
    return
  }

  for (const p of projects) {
    console.log('\n' + '='.repeat(80))
    console.log(`PROJECT: ${p.name} (${p.id})`)
    console.log(`status=${p.status} stage=${p.current_stage} validation=${p.validation_status}`)
    console.log(`errors=${p.error_count} warnings=${p.warning_count} last_validated=${p.last_validated_at}`)
    console.log('error_summary:', JSON.stringify(p.error_summary))
    console.log('wizard_state:', JSON.stringify(p.wizard_state))

    const files = await pool.query(
      `SELECT id, original_filename, entity_type, parse_status, row_count, is_active, uploaded_at
       FROM migration_files WHERE migration_id = $1 ORDER BY uploaded_at DESC`,
      [p.id]
    )
    console.log('\nFILES:')
    for (const f of files.rows) {
      console.log(
        `  [${f.is_active ? 'active' : 'inactive'}] ${f.original_filename} entity=${f.entity_type} parse=${f.parse_status} rows=${f.row_count}`
      )
    }

    const staging = await pool.query(
      `SELECT validation_status, COUNT(*)::int c
       FROM migration_staging_rows WHERE migration_id = $1
       GROUP BY validation_status ORDER BY c DESC`,
      [p.id]
    )
    console.log('\nSTAGING by validation_status:', staging.rows)

    const entity = await pool.query(
      `SELECT entity_type, validation_status, COUNT(*)::int c
       FROM migration_staging_rows WHERE migration_id = $1
       GROUP BY entity_type, validation_status ORDER BY entity_type, c DESC`,
      [p.id]
    )
    console.log('STAGING by entity+status:', entity.rows)

    const eligible = await pool.query(
      `SELECT COUNT(*)::int c FROM migration_staging_rows
       WHERE migration_id = $1
         AND production_id IS NULL
         AND intended_action <> 'skip'
         AND validation_status IN ('valid', 'warning', 'corrected')`,
      [p.id]
    )
    console.log('Eligible for import:', eligible.rows[0].c)

    const pending = await pool.query(
      `SELECT COUNT(*)::int c FROM migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'pending'`,
      [p.id]
    )
    console.log('Still pending validation:', pending.rows[0].c)

    const errorCodes = await pool.query(
      `SELECT jsonb_array_elements(errors)->>'code' AS code, COUNT(*)::int c
       FROM migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'error'
       GROUP BY 1 ORDER BY c DESC LIMIT 10`,
      [p.id]
    )
    if (errorCodes.rows.length) {
      console.log('\nERROR codes:')
      errorCodes.rows.forEach((r) => console.log(`  ${r.c}x ${r.code}`))
    }

    const errorSamples = await pool.query(
      `SELECT row_number, entity_type, validation_status, errors, warnings,
              raw_data->>'product_name' AS product, raw_data->>'delivery_date' AS date
       FROM migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'error'
       ORDER BY row_number LIMIT 5`,
      [p.id]
    )
    if (errorSamples.rows.length) {
      console.log('\nSAMPLE error rows:')
      for (const r of errorSamples.rows) {
        console.log(`  row ${r.row_number} (${r.entity_type}): ${JSON.stringify(r.errors)}`)
      }
    }

    const jobs = await pool.query(
      `SELECT job_type, status, progress_pct, error_message, created_at, completed_at
       FROM migration_jobs WHERE migration_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [p.id]
    )
    console.log('\nRECENT JOBS:')
    jobs.rows.forEach((j) =>
      console.log(`  ${j.job_type} ${j.status} ${j.progress_pct}% err=${j.error_message ?? ''}`)
    )
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
