/**
 * Import delivery rows from an admin migration-deliveries-template workbook.
 * Skips Palm Oil 1L demo row; sets PALACE / SPINTEX.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/run-deliveries-template-migration.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/run-deliveries-template-migration.ts dotenv_config_path=.env.local --apply
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
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
const SOURCE_FILE = resolve(FIX_DIR, 'migration-deliveries-template_ 2 correction.xlsx')
const SLUG = 'template-2-correction'
const UPLOAD_FILE = resolve(FIX_DIR, `DELIVERIES-${SLUG}-UPLOAD.xlsx`)
const STATE_FILE = resolve(FIX_DIR, `deliveries-${SLUG}-migration-state.json`)

const DATA_COLS = [
  'supermarket_name',
  'product_name',
  'quantity',
  'delivery_date',
  'branch',
  'store_code',
  'barcode',
] as const

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

function loadState(): { migrationId?: string; status?: string } {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state: Record<string, unknown>) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function isDemoRow(r: Record<string, unknown>) {
  return /palm oil 1l/i.test(String(r.product_name ?? ''))
}

async function buildUploadFile(): Promise<number> {
  if (!existsSync(SOURCE_FILE)) throw new Error(`Source not found: ${SOURCE_FILE}`)
  const { rows } = await parseWorkbook(readFileSync(SOURCE_FILE))
  const clean = rows.filter((r) => !isDemoRow(r))
  if (!clean.length) throw new Error('No data rows after excluding demo')

  const uploadRows = clean.map((row) => {
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
    rows: uploadRows,
    legend: [],
    columnWidths: { product_name: 42, barcode: 16 },
  })
  return uploadRows.length
}

async function drainJobs(pool: pg.Pool, migrationId: string, maxRounds = 400) {
  for (let i = 0; i < maxRounds; i++) {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM migration_jobs WHERE migration_id = $1 AND status IN ('queued','running')`,
      [migrationId]
    )
    if (rows[0].c === 0) return
    await processMigrationJobs(pool, { maxJobs: 8 })
  }
  throw new Error('Job queue did not drain')
}

async function runPipeline(pool: pg.Pool, migrationId: string, actorId: string) {
  await enqueueJob(pool, { migrationId, jobType: 'parse', actorId })
  await drainJobs(pool, migrationId)
  await enqueueJob(pool, { migrationId, jobType: 'validate', actorId })
  await drainJobs(pool, migrationId)

  const project = await getMigrationProject(pool, migrationId)
  if (!project) throw new Error('Migration missing after validate')
  console.log('Validation:', {
    error_count: project.error_count,
    warning_count: project.warning_count,
  })
  if ((project.error_count ?? 0) > 0) throw new Error(`Validation errors: ${project.error_count}`)

  const missing = await countStagingRowsMissingProductId(pool, migrationId)
  if (missing > 0) throw new Error(`${missing} rows missing product_id`)

  if (!apply) {
    console.log('Dry run OK — use --apply to import')
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
      wizard_state: { stage: 7, auto_approved: true },
      import_order: ['deliveries'] as MigrationEntityType[],
    },
    actorId,
    'migration.approved'
  )

  const { rows: elig } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'deliveries' AND production_id IS NULL
       AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
    [migrationId]
  )
  await enqueueJob(pool, {
    migrationId,
    jobType: 'import',
    entityType: 'deliveries',
    totalRecords: elig[0].c,
    actorId,
  })
  await enqueueJob(pool, { migrationId, jobType: 'reconcile', actorId })
  await updateMigrationProject(pool, migrationId, { status: 'importing', current_stage: 8, progress_pct: 5 })
  await drainJobs(pool, migrationId)

  const failed = (await listJobs(pool, migrationId)).filter((j) => j.status === 'failed')
  if (failed.length) throw new Error('Import jobs failed')
  return getMigrationProject(pool, migrationId)
}

async function main() {
  const state = loadState()
  if (!force && (state.status === 'completed' || state.status === 'balanced')) {
    console.log('Already completed:', state.migrationId, state.status)
    return
  }

  const rowCount = await buildUploadFile()
  console.log(`Upload: ${rowCount} rows → ${UPLOAD_FILE}`)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const actorId = await getActorId(pool)
  const project = await createMigrationProject(pool, {
    name: `Delivery template correction (${basename(SOURCE_FILE)})`,
    description: `${rowCount} Palace Spintex delivery backfill rows`,
    createdBy: actorId,
  })

  await attachMigrationFile(pool, {
    migrationId: project.id,
    filename: basename(UPLOAD_FILE),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: readFileSync(UPLOAD_FILE),
    entityType: 'deliveries',
    actorId,
  })

  const final = await runPipeline(pool, project.id, actorId)
  console.log('Final:', final?.status, final?.reconciliation)

  if (apply) {
    saveState({
      migrationId: project.id,
      rowCount,
      status: final?.status,
      completedAt: final?.completed_at,
    })
  }
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
