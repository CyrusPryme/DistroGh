/**
 * Import NASMIN (Aunty Lulu) supplemental Palace Spintex deliveries from admin template.
 *
 * Rows are additive: db_delivered + file_qty = received per SKU (clears vendor WH on hand).
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/run-lulu-deliveries-migration.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/run-lulu-deliveries-migration.ts dotenv_config_path=.env.local --apply
 *   npx tsx -r dotenv/config scripts/run-lulu-deliveries-migration.ts dotenv_config_path=.env.local --apply --force
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
import type { MigrationEntityType } from '@/lib/migration/types'
import { migrationProgressForStage } from '@/lib/migration/lifecycle'
import { writeFixedMigrationWorkbook } from '@/lib/migration/fix-workbook'

const FIX_DIR = resolve(process.cwd(), 'discrepancies fix')
const SOURCE_FILE = resolve(FIX_DIR, 'migration-deliveries-template_LULU SHITO.xlsx')
const UPLOAD_FILE = resolve(FIX_DIR, 'LULU-SHITO-DELIVERIES-UPLOAD.xlsx')
const STATE_FILE = resolve(FIX_DIR, 'lulu-deliveries-migration-state.json')

const DATA_COLS = [
  'supermarket_name',
  'product_name',
  'quantity',
  'delivery_date',
  'branch',
  'store_code',
  'barcode',
] as const

type LuluMigrationState = {
  migrationId?: string
  rowCount?: number
  status?: string
  completedAt?: string
}

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

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

function loadState(): LuluMigrationState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as LuluMigrationState
  } catch {
    return {}
  }
}

function saveState(state: LuluMigrationState) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

async function buildUploadFile(): Promise<number> {
  if (!existsSync(SOURCE_FILE)) throw new Error(`Source file not found: ${SOURCE_FILE}`)
  const { rows } = await parseWorkbook(readFileSync(SOURCE_FILE))
  const luluRows = rows.filter((r) => /LULU/i.test(String(r.product_name ?? '')))
  if (luluRows.length !== 6) {
    throw new Error(`Expected 6 Aunty Lulu rows, got ${luluRows.length} (exclude template Palm Oil demo row)`)
  }

  const cleanRows = luluRows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const col of DATA_COLS) out[col] = row[col] ?? ''
    out.supermarket_name = 'PALACE'
    out.branch = 'SPINTEX'
    return out
  })

  await writeFixedMigrationWorkbook({
    outputPath: UPLOAD_FILE,
    dataColumns: DATA_COLS,
    dateColumns: ['delivery_date'],
    rows: cleanRows,
    legend: [],
    columnWidths: { product_name: 42, barcode: 16 },
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
  const entity: MigrationEntityType = 'deliveries'
  const { rows } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = $2 AND production_id IS NULL
       AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
    [migrationId, entity]
  )
  if (rows[0].c === 0) throw new Error('No eligible delivery rows to import')
  await enqueueJob(pool, {
    migrationId,
    jobType: 'import',
    entityType: entity,
    totalRecords: rows[0].c,
    actorId,
  })
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

  const { rows: stagingPreview } = await pool.query(
    `SELECT row_number, validation_status, warnings, resolved_refs
     FROM migration_staging_rows WHERE migration_id = $1 AND entity_type = 'deliveries'
     ORDER BY row_number`,
    [migrationId]
  )
  console.log('Staging preview:', stagingPreview)

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

  if (!apply) {
    console.log('\nDry run OK — re-run with --apply to import deliveries.')
    return project
  }

  await updateMigrationProject(
    pool,
    migrationId,
    {
      status: 'approved',
      current_stage: 7,
      progress_pct: migrationProgressForStage(7, 'approved'),
      approved_by: actorId,
      wizard_state: { stage: 7, approved_at: new Date().toISOString(), auto_approved: true },
      import_order: ['deliveries'],
    },
    actorId,
    'migration.approved'
  )

  await startImport(pool, migrationId, actorId)
  await drainJobs(pool, migrationId)

  const jobs = await listJobs(pool, migrationId)
  const failed = jobs.filter((j) => j.status === 'failed')
  if (failed.length) {
    console.error('Failed jobs:', failed.map((j) => ({ type: j.job_type, error: j.error_message })))
    throw new Error('Import jobs failed — see logs above')
  }
  return getMigrationProject(pool, migrationId)
}

async function main() {
  const state = loadState()
  if (!force && (state.status === 'completed' || state.status === 'balanced')) {
    console.log('Lulu deliveries migration already completed:', state.migrationId, state.status)
    console.log('Use --force to run again (will duplicate deliveries).')
    return
  }

  const rowCount = await buildUploadFile()
  console.log(`Upload file: ${rowCount} rows → ${UPLOAD_FILE}`)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const actorId = await getActorId(pool)
  console.log('Actor:', actorId)

  try {
    const project = await createMigrationProject(pool, {
      name: `NASMIN Lulu Spintex deliveries (${new Date().toISOString().slice(0, 10)})`,
      description: `${rowCount} supplemental Palace Spintex delivery rows from migration-deliveries-template_LULU SHITO.xlsx`,
      createdBy: actorId,
    })
    console.log('Created migration project:', project.id)

    const buffer = readFileSync(UPLOAD_FILE)
    await attachMigrationFile(pool, {
      migrationId: project.id,
      filename: 'LULU-SHITO-DELIVERIES-UPLOAD.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
      entityType: 'deliveries',
      actorId,
    })

    const final = await runPipeline(pool, project.id, actorId)
    console.log('Final status:', final?.status)
    console.log('Reconciliation:', final?.reconciliation)

    if (apply) {
      const imported = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM migration_staging_rows
         WHERE migration_id = $1 AND entity_type = 'deliveries' AND production_id IS NOT NULL`,
        [project.id]
      )
      console.log('Deliveries imported:', imported.rows[0].c)

      saveState({
        migrationId: project.id,
        rowCount,
        status: final?.status,
        completedAt: final?.completed_at ?? undefined,
      })
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
