import 'dotenv/config'
import { Pool } from 'pg'

const search = process.argv[2] || 'MAIDEN PRODUCTS UPLOAD'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment',
})

async function main() {
  const { rows: projects } = await pool.query(
    `SELECT * FROM public.migration_projects WHERE name ILIKE $1 ORDER BY created_at DESC`,
    [`%${search}%`]
  )

  if (!projects.length) {
    console.log(`No migration project found matching "${search}"`)
    const { rows: all } = await pool.query(`SELECT id, name, status, created_at FROM public.migration_projects ORDER BY created_at DESC LIMIT 20`)
    console.log('\nRecent migrations in DB:')
    for (const p of all) console.log(`  - [${p.status}] ${p.name} (${p.id}) created ${p.created_at}`)
    return
  }

  for (const project of projects) {
    console.log('='.repeat(100))
    console.log('PROJECT:', project.name, '(', project.id, ')')
    console.log('='.repeat(100))
    console.log('status:', project.status)
    console.log('current_stage:', project.current_stage)
    console.log('progress_pct:', project.progress_pct)
    console.log('validation_status:', project.validation_status)
    console.log('files_uploaded:', project.files_uploaded)
    console.log('error_count:', project.error_count)
    console.log('warning_count:', project.warning_count)
    console.log('created_at:', project.created_at)
    console.log('started_at:', project.started_at)
    console.log('completed_at:', project.completed_at)
    console.log('last_activity_at:', project.last_activity_at)
    console.log('rollback_available:', project.rollback_available)
    console.log('\n--- error_summary ---')
    console.log(JSON.stringify(project.error_summary, null, 2))
    console.log('\n--- wizard_state ---')
    console.log(JSON.stringify(project.wizard_state, null, 2))
    console.log('\n--- import_order ---')
    console.log(JSON.stringify(project.import_order, null, 2))
    console.log('\n--- preview_summary ---')
    console.log(JSON.stringify(project.preview_summary, null, 2))
    console.log('\n--- reconciliation ---')
    console.log(JSON.stringify(project.reconciliation, null, 2))

    const { rows: files } = await pool.query(
      `SELECT id, entity_type, original_filename, parse_status, parse_error, row_count, size_bytes, is_active, uploaded_at, replaced_at
       FROM public.migration_files WHERE migration_id = $1 ORDER BY uploaded_at ASC`,
      [project.id]
    )
    console.log('\n--- FILES (' + files.length + ') ---')
    for (const f of files) {
      console.log(`  [${f.is_active ? 'ACTIVE' : 'inactive'}] ${f.original_filename} entity=${f.entity_type} parse=${f.parse_status} rows=${f.row_count} size=${f.size_bytes}B uploaded=${f.uploaded_at}`)
      if (f.parse_error) console.log(`    parse_error: ${f.parse_error}`)
    }

    const { rows: jobs } = await pool.query(
      `SELECT id, job_type, entity_type, status, progress_pct, current_record, total_records, error_message, created_at, started_at, completed_at
       FROM public.migration_jobs WHERE migration_id = $1 ORDER BY created_at ASC`,
      [project.id]
    )
    console.log('\n--- JOBS (' + jobs.length + ') ---')
    for (const j of jobs) {
      console.log(`  [${j.status}] ${j.job_type} entity=${j.entity_type} progress=${j.progress_pct}% ${j.current_record}/${j.total_records} created=${j.created_at} started=${j.started_at} completed=${j.completed_at}`)
      if (j.error_message) console.log(`    error: ${j.error_message}`)
    }

    const { rows: stagingSummary } = await pool.query(
      `SELECT entity_type, validation_status, intended_action, COUNT(*)::int AS c,
              COUNT(production_id)::int AS imported_c
       FROM public.migration_staging_rows WHERE migration_id = $1
       GROUP BY entity_type, validation_status, intended_action
       ORDER BY entity_type, validation_status`,
      [project.id]
    )
    console.log('\n--- STAGING ROW SUMMARY ---')
    for (const s of stagingSummary) {
      console.log(`  ${s.entity_type} | ${s.validation_status} | ${s.intended_action} | count=${s.c} | imported=${s.imported_c}`)
    }

    const { rows: errorSamples } = await pool.query(
      `SELECT row_number, errors, warnings, raw_data, normalized_data
       FROM public.migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'error'
       ORDER BY row_number ASC LIMIT 15`,
      [project.id]
    )
    console.log('\n--- SAMPLE ERROR ROWS (' + errorSamples.length + ' shown) ---')
    for (const r of errorSamples) {
      console.log(`  row ${r.row_number}: errors=${JSON.stringify(r.errors)}`)
    }

    const { rows: audit } = await pool.query(
      `SELECT action, stage, details, created_at, actor_id
       FROM public.migration_audit_events WHERE migration_id = $1
       ORDER BY created_at ASC`,
      [project.id]
    )
    console.log('\n--- AUDIT TRAIL (' + audit.length + ') ---')
    for (const a of audit) {
      console.log(`  ${a.created_at} | ${a.action} | stage=${a.stage} | actor=${a.actor_id}`)
      const detailsStr = JSON.stringify(a.details)
      if (detailsStr && detailsStr !== '{}') console.log(`    details: ${detailsStr}`)
    }

    console.log('\n')
  }

  await pool.end()
}

main().catch((e) => {
  console.error('ERROR:', e)
  process.exit(1)
})
