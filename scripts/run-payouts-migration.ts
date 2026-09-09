/**
 * Import historical vendor payouts migration (supports multiple batch files).
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/run-payouts-migration.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/run-payouts-migration.ts dotenv_config_path=.env.local --file "payouts migration/migration-payouts-template 2nd.xlsx"
 *   npx tsx -r dotenv/config scripts/run-payouts-migration.ts dotenv_config_path=.env.local --apply
 *
 * Place batch files in payouts migration/ — e.g. migration-payouts-template 1st.xlsx, 2nd.xlsx, …
 * Already-imported filenames are skipped unless --apply is passed with --file.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, basename } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { attachMigrationFile } from '@/lib/migration/files'
import { createMigrationProject, getMigrationProject, updateMigrationProject } from '@/lib/migration/projects'
import { enqueueJob, listJobs } from '@/lib/migration/jobs'
import { processMigrationJobs } from '@/lib/migration/process'
import type { MigrationEntityType } from '@/lib/migration/types'
import { migrationProgressForStage } from '@/lib/migration/lifecycle'
import { writeFixedMigrationWorkbook } from '@/lib/migration/fix-workbook'

const PAYOUTS_DIR = resolve(process.cwd(), 'payouts migration')
const UPLOAD_FILE = resolve(PAYOUTS_DIR, 'payouts-UPLOAD.xlsx')
const STATE_FILE = resolve(PAYOUTS_DIR, 'payouts-migration-state.json')
const IMPORTED_DIR = resolve(PAYOUTS_DIR, 'imported')

const DATA_COLS = [
  'vendor_name',
  'amount_paid',
  'amount_due',
  'payout_date',
  'week_start',
  'week_end',
  'status',
  'transaction_id',
] as const

type PayoutBatch = {
  file: string
  migrationId: string
  rows: number
  status: string
  completedAt?: string
}

type PayoutsMigrationState = {
  batches?: PayoutBatch[]
  totalImported?: number
  /** @deprecated single-batch fields — migrated to batches[] on load */
  migrationId?: string
  rowCount?: number
  status?: string
  completedAt?: string
}

function parseArgs(): { filePath?: string; force: boolean } {
  const argv = process.argv.slice(2)
  let filePath: string | undefined
  let force = argv.includes('--apply') || argv.includes('--force')
  const fileIdx = argv.findIndex((a) => a === '--file')
  if (fileIdx >= 0 && argv[fileIdx + 1]) {
    filePath = resolve(process.cwd(), argv[fileIdx + 1]!)
  }
  return { filePath, force }
}

function loadState(): PayoutsMigrationState {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as PayoutsMigrationState
    if (!raw.batches?.length && raw.migrationId) {
      raw.batches = [
        {
          file: '(legacy batch)',
          migrationId: raw.migrationId,
          rows: raw.rowCount ?? 0,
          status: raw.status ?? 'completed',
          completedAt: raw.completedAt,
        },
      ]
      raw.totalImported = raw.rowCount ?? 0
    }
    return raw
  } catch {
    return { batches: [], totalImported: 0 }
  }
}

function saveState(state: PayoutsMigrationState) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function listBatchCandidates(): string[] {
  if (!existsSync(PAYOUTS_DIR)) return []
  return readdirSync(PAYOUTS_DIR)
    .filter(
      (f) =>
        f.endsWith('.xlsx') &&
        !f.startsWith('~$') &&
        f !== 'payouts-TEMPLATE.xlsx' &&
        f !== 'payouts-UPLOAD.xlsx' &&
        !f.startsWith('payouts-UPLOAD')
    )
    .map((f) => join(PAYOUTS_DIR, f))
    .sort()
}

function resolveInputFile(state: PayoutsMigrationState, explicit?: string): string {
  if (explicit) {
    const p = resolve(process.cwd(), explicit)
    if (!existsSync(p)) throw new Error(`File not found: ${p}`)
    return p
  }

  const imported = new Set((state.batches ?? []).map((b) => b.file))
  const pending = listBatchCandidates().filter((p) => !imported.has(basename(p)))
  if (pending.length === 0) {
    throw new Error(
      `No new payout batch file in ${PAYOUTS_DIR}.\n` +
        `Add migration-payouts-template 2nd.xlsx (etc.) or pass --file path.\n` +
        `Already imported: ${[...imported].join(', ') || '(none)'}`
    )
  }
  if (pending.length > 1) {
    console.log('Multiple pending files — importing first:', basename(pending[0]))
    console.log('Others:', pending.slice(1).map(basename).join(', '))
  }
  return pending[0]
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

async function buildUploadFile(fromPath: string): Promise<number> {
  const { rows } = await parseWorkbook(readFileSync(fromPath))
  if (!rows.length) throw new Error('Payouts file has no data rows')

  const cleanRows = rows
    .map((row) => {
      const out: Record<string, unknown> = {}
      for (const col of DATA_COLS) out[col] = row[col] ?? ''
      const paid = Number(row.amount_paid ?? row.amount)
      if (!out.amount_due && Number.isFinite(paid)) out.amount_due = paid
      if (!out.status) out.status = 'completed'
      return out
    })
    .filter((row) => {
      const vendor = String(row.vendor_name ?? '').trim()
      const paid = Number(row.amount_paid)
      const date = String(row.payout_date ?? row.week_start ?? '').trim()
      return vendor && Number.isFinite(paid) && paid > 0 && date
    })

  if (!cleanRows.length) throw new Error('No valid payout rows after filtering empty lines')

  await writeFixedMigrationWorkbook({
    outputPath: UPLOAD_FILE,
    dataColumns: DATA_COLS,
    dateColumns: ['payout_date', 'week_start', 'week_end'],
    rows: cleanRows,
    legend: [],
    columnWidths: { vendor_name: 42, transaction_id: 24 },
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
  const { rows } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'payouts' AND production_id IS NULL
       AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
    [migrationId]
  )
  if (rows[0].c === 0) throw new Error('No eligible payout rows to import')
  await enqueueJob(pool, {
    migrationId,
    jobType: 'import',
    entityType: 'payouts',
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

  if ((project.error_count ?? 0) > 0) {
    const { rows } = await pool.query(
      `SELECT row_number, errors FROM public.migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'error' ORDER BY row_number LIMIT 10`,
      [migrationId]
    )
    console.error('Sample validation errors:', rows)
    throw new Error(`Validation failed with ${project.error_count} error rows`)
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
      import_order: ['payouts'] as MigrationEntityType[],
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
  const { filePath: explicitFile, force } = parseArgs()
  const state = loadState()
  const fromPath = resolveInputFile(state, explicitFile)
  const fileName = basename(fromPath)

  if (!force && (state.batches ?? []).some((b) => b.file === fileName && b.status === 'completed')) {
    console.log(`Already imported: ${fileName} (${state.batches!.find((b) => b.file === fileName)!.migrationId})`)
    console.log('Pass --apply --file … to re-import, or add the next batch file.')
    return
  }

  const rowCount = await buildUploadFile(fromPath)
  console.log(`Batch: ${fileName}`)
  console.log(`Upload file ready: ${rowCount} rows → ${UPLOAD_FILE}`)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const actorId = await getActorId(pool)
  console.log('Actor:', actorId)

  try {
    const batchLabel = fileName.replace(/\.xlsx$/i, '')
    const project = await createMigrationProject(pool, {
      name: `Historical Payouts — ${batchLabel}`,
      description: `Vendor MoMo payouts — ${rowCount} rows from ${fileName}`,
      createdBy: actorId,
    })
    console.log('Created migration project:', project.id)

    await attachMigrationFile(pool, {
      migrationId: project.id,
      filename: `${batchLabel}-UPLOAD.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: readFileSync(UPLOAD_FILE),
      entityType: 'payouts',
      actorId,
    })

    const final = await runPipeline(pool, project.id, actorId)
    console.log('Final status:', final?.status)
    console.log('Reconciliation:', final?.reconciliation)

    const imported = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM migration_staging_rows
       WHERE migration_id = $1 AND entity_type = 'payouts' AND production_id IS NOT NULL`,
      [project.id]
    )
    const importedCount = imported.rows[0].c
    console.log('Payouts imported this batch:', importedCount)

    const batches = (state.batches ?? []).filter((b) => b.file !== fileName)
    batches.push({
      file: fileName,
      migrationId: project.id,
      rows: importedCount,
      status: final?.status ?? 'completed',
      completedAt: new Date().toISOString(),
    })
    const totalImported = (state.totalImported ?? 0) + importedCount
    saveState({ batches, totalImported })

    mkdirSync(IMPORTED_DIR, { recursive: true })
    console.log(`\nCumulative payouts imported: ${totalImported} (${batches.length} batch(es))`)
    console.log('Next: add migration-payouts-template 2nd.xlsx to payouts migration/ and re-run.')
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
