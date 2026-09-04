/**
 * Upload and import Palace returns maiden migration (returns-MAIDEN-FIXED.xlsx).
 *
 * Usage: npx tsx -r dotenv/config scripts/run-returns-migration.ts dotenv_config_path=.env.local
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { attachMigrationFile } from '@/lib/migration/files'
import { createMigrationProject, getMigrationProject, updateMigrationProject } from '@/lib/migration/projects'
import { enqueueJob, listJobs } from '@/lib/migration/jobs'
import { processMigrationJobs } from '@/lib/migration/process'
import { countStagingRowsMissingProductId } from '@/lib/migration/validate'
import { CANONICAL_IMPORT_ORDER } from '@/lib/migration/entities'
import type { MigrationEntityType } from '@/lib/migration/types'
import { migrationProgressForStage } from '@/lib/migration/lifecycle'
import { writeFixedMigrationWorkbook } from '@/lib/migration/fix-workbook'

const RETURNS_DIR = resolve(process.cwd(), 'returned migration')
const FIXED_FILE = resolve(RETURNS_DIR, 'returns-MAIDEN-FIXED.xlsx')
const UPLOAD_FILE = resolve(RETURNS_DIR, 'returns-MAIDEN-UPLOAD.xlsx')
const STATE_FILE = resolve(RETURNS_DIR, 'returns-migration-state.json')

const DATA_COLS = [
  'product_name',
  'quantity',
  'return_date',
  'reason',
  'supermarket_name',
  'branch',
  'barcode',
  'notes',
] as const

type ReturnsMigrationState = {
  migrationId?: string
  projectName?: string
  rowCount?: number
  status?: string
  completedAt?: string
}

async function getActorId(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT u.id FROM public.users u
     JOIN public.admin_profiles ap ON ap.user_id = u.id
     WHERE ap.admin_role IN ('developer', 'super_admin')
     ORDER BY CASE ap.admin_role WHEN 'developer' THEN 0 ELSE 1 END
     LIMIT 1`
  )
  if (!rows[0]?.id) throw new Error('No developer/super_admin user found for migration actor')
  return rows[0].id
}

function loadState(): ReturnsMigrationState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as ReturnsMigrationState
  } catch {
    return {}
  }
}

function saveState(state: ReturnsMigrationState) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

/** Strip review_flag and other wizard-only columns before upload. */
async function buildUploadFile(): Promise<number> {
  const { rows } = await parseWorkbook(readFileSync(FIXED_FILE))
  const cleanRows = rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const col of DATA_COLS) out[col] = row[col] ?? ''
    return out
  })
  await writeFixedMigrationWorkbook({
    outputPath: UPLOAD_FILE,
    dataColumns: DATA_COLS,
    dateColumns: ['return_date'],
    rows: cleanRows,
    legend: [],
    columnWidths: { product_name: 42, barcode: 16, notes: 72 },
  })
  return cleanRows.length
}

async function drainJobs(pool: pg.Pool, migrationId: string, maxRounds = 400): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM public.migration_jobs
       WHERE migration_id = $1 AND status IN ('queued','running')`,
      [migrationId]
    )
    if (rows[0].c === 0) return
    await processMigrationJobs(pool, { maxJobs: 8 })
  }
  throw new Error('Job queue did not drain — check failed migration_jobs')
}

async function startImport(pool: pg.Pool, migrationId: string, actorId: string) {
  const project = await getMigrationProject(pool, migrationId)
  if (!project) throw new Error('Migration not found')

  const order = (project.import_order.length ? project.import_order : CANONICAL_IMPORT_ORDER) as MigrationEntityType[]
  let totalEligible = 0
  for (const entity of order) {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
       WHERE migration_id = $1 AND entity_type = $2 AND production_id IS NULL
         AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
      [migrationId, entity]
    )
    totalEligible += rows[0].c
    if (rows[0].c > 0) {
      await enqueueJob(pool, {
        migrationId,
        jobType: 'import',
        entityType: entity,
        totalRecords: rows[0].c,
        actorId,
      })
    }
  }
  if (totalEligible === 0) throw new Error('No eligible rows to import')
  await enqueueJob(pool, { migrationId, jobType: 'reconcile', actorId })
  await updateMigrationProject(pool, migrationId, {
    status: 'importing',
    current_stage: 8,
    progress_pct: 5,
  })
}

async function runPipeline(pool: pg.Pool, migrationId: string, actorId: string) {
  await enqueueJob(pool, { migrationId, jobType: 'parse', actorId })
  await drainJobs(pool, migrationId)

  await enqueueJob(pool, { migrationId, jobType: 'validate', actorId })
  await drainJobs(pool, migrationId)

  const project = await getMigrationProject(pool, migrationId)
  if (!project) throw new Error('Migration vanished after validate')

  console.log('Validation:', {
    status: project.status,
    error_count: project.error_count,
    warning_count: project.warning_count,
  })

  if ((project.error_count ?? 0) > 0) {
    const { rows } = await pool.query(
      `SELECT row_number, errors FROM public.migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'error' ORDER BY row_number LIMIT 10`,
      [migrationId]
    )
    console.error('Sample validation errors:', rows)
    throw new Error(`Validation failed with ${project.error_count} error rows`)
  }

  const missingProducts = await countStagingRowsMissingProductId(pool, migrationId)
  if (missingProducts > 0) throw new Error(`${missingProducts} rows missing resolvable product_id`)

  await updateMigrationProject(
    pool,
    migrationId,
    {
      status: 'approved',
      current_stage: 7,
      progress_pct: migrationProgressForStage(7, 'approved'),
      approved_by: actorId,
      wizard_state: { stage: 7, approved_at: new Date().toISOString(), auto_approved: true },
      import_order: ['returns'],
    },
    actorId,
    'migration.approved'
  )

  await startImport(pool, migrationId, actorId)
  await drainJobs(pool, migrationId)

  const final = await getMigrationProject(pool, migrationId)
  const jobs = await listJobs(pool, migrationId)
  const failed = jobs.filter((j) => j.status === 'failed')
  if (failed.length) {
    console.error('Failed jobs:', failed.map((j) => ({ type: j.job_type, error: j.error_message })))
    throw new Error('Import jobs failed — see logs above')
  }
  return final
}

async function main() {
  if (!existsSync(FIXED_FILE)) {
    throw new Error(`Fixed returns file not found: ${FIXED_FILE}`)
  }

  const state = loadState()
  if (state.status === 'completed' || state.status === 'balanced') {
    console.log('Returns migration already completed:', state.migrationId, state.status)
    return
  }

  const rowCount = await buildUploadFile()
  console.log(`Upload file ready: ${rowCount} rows → ${UPLOAD_FILE}`)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const actorId = await getActorId(pool)
  console.log('Actor:', actorId)

  try {
    const project = await createMigrationProject(pool, {
      name: `Returns Maiden (${new Date().toISOString().slice(0, 10)})`,
      description: `Palace Spintex historical returns — ${rowCount} rows from returns-MAIDEN-FIXED.xlsx`,
      createdBy: actorId,
    })
    console.log('Created migration project:', project.id)

    const buffer = readFileSync(UPLOAD_FILE)
    await attachMigrationFile(pool, {
      migrationId: project.id,
      filename: 'returns-MAIDEN-UPLOAD.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
      entityType: 'returns',
      actorId,
    })

    const final = await runPipeline(pool, project.id, actorId)
    console.log('Final status:', final?.status)
    console.log('Reconciliation:', final?.reconciliation)

    const imported = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM migration_staging_rows
       WHERE migration_id = $1 AND entity_type = 'returns' AND production_id IS NOT NULL`,
      [project.id]
    )
    console.log('Returns imported:', imported.rows[0].c)

    saveState({
      migrationId: project.id,
      projectName: project.name,
      rowCount,
      status: final?.status,
      completedAt: final?.completed_at ?? undefined,
    })
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
