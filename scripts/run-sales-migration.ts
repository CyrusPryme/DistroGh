/**
 * Run Palace historical sales migration (phase 1 = ready rows, phase 2 = deferred rows).
 *
 * Phase 1:
 *   npx tsx -r dotenv/config scripts/run-sales-migration.ts phase1 dotenv_config_path=.env.local
 *
 * Phase 2 (after corrected products file / catalog updated):
 *   npx tsx -r dotenv/config scripts/run-sales-migration.ts phase2 dotenv_config_path=.env.local
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import ExcelJS from 'exceljs'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { attachMigrationFile } from '@/lib/migration/files'
import { createMigrationProject, getMigrationProject, updateMigrationProject } from '@/lib/migration/projects'
import { enqueueJob, listJobs } from '@/lib/migration/jobs'
import { processMigrationJobs } from '@/lib/migration/process'
import { countStagingRowsMissingProductId } from '@/lib/migration/validate'
import { CANONICAL_IMPORT_ORDER } from '@/lib/migration/entities'
import type { MigrationEntityType } from '@/lib/migration/types'
import { ddMmYyyyToReportMonth } from './fix-sales-migration-file'
import { migrationProgressForStage } from '@/lib/migration/lifecycle'

const SALES_DIR = resolve(process.cwd(), 'sales migration')
const FIXED_FILE = resolve(SALES_DIR, 'migration-sales-FIXED.xlsx')
const PHASE1_FILE = resolve(SALES_DIR, 'migration-sales-PHASE1.xlsx')
const CORRECTION_FILE = resolve(SALES_DIR, 'migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx')
const STATE_FILE = resolve(SALES_DIR, 'migration-state.json')

const MISSING_BARCODES_PHASE1 = [
  '100200109397', '200410', '342787011143', '342787014020', '342787021421',
  '603400006300', '603400006305', '603400006311', '603400006314', '603400018384',
  '603400090208', '603600020187', '603600021450', '603600021451', '603600021454',
  '603600021455', '603600195815', '603602777111', '741813084503', '741813084671',
  '777710027645', '839675001711',
]

type MigrationState = {
  phase1?: {
    migrationId: string
    projectName: string
    rowCount: number
    completedAt?: string
    status?: string
  }
  phase2?: {
    migrationId: string
    projectName: string
    rowCount: number
    completedAt?: string
    status?: string
  }
  deferredBarcodes: string[]
  createdAt: string
  updatedAt: string
}

function normalizeBarcode(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  return String(v).trim()
}

function loadState(): MigrationState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as MigrationState
  } catch {
    return {
      deferredBarcodes: MISSING_BARCODES_PHASE1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
}

function saveState(state: MigrationState) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  state.updatedAt = new Date().toISOString()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
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

async function buildFilteredXlsx(
  sourcePath: string,
  outputPath: string,
  excludeBarcodes: Set<string>
): Promise<number> {
  const { rows } = await parseWorkbook(readFileSync(sourcePath))
  const kept = rows.filter((r) => {
    const code = normalizeBarcode(r.code ?? r.Code).toLowerCase()
    return code && !excludeBarcodes.has(code)
  })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  const cols = ['description', 'code', 'qty', 'store_name', 'TCostEx', 'report_month', 'paid'] as const
  ws.addRow([...cols])
  for (const r of kept) {
    ws.addRow([
      r.description ?? r.code,
      r.code,
      r.qty,
      r.store_name,
      r.TCostEx,
      r.report_month,
      r.paid ?? '',
    ])
  }
  await wb.xlsx.writeFile(outputPath)
  return kept.length
}

async function countMissingSupermarketIds(pool: pg.Pool, migrationId: string): Promise<number> {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'sales'
       AND production_id IS NULL AND intended_action <> 'skip'
       AND validation_status IN ('valid','warning','corrected')
       AND COALESCE(resolved_refs->>'supermarket_id', '') = ''`,
    [migrationId]
  )
  return rows[0].c
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
  throw new Error('Job queue did not drain — increase maxRounds or check failed jobs')
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
  const missingSupermarkets = await countMissingSupermarketIds(pool, migrationId)
  if (missingProducts > 0) throw new Error(`${missingProducts} rows missing resolvable product_id`)
  if (missingSupermarkets > 0) throw new Error(`${missingSupermarkets} rows missing resolvable supermarket_id`)

  await updateMigrationProject(
    pool,
    migrationId,
    {
      status: 'approved',
      current_stage: 7,
      progress_pct: migrationProgressForStage(7, 'approved'),
      approved_by: actorId,
      wizard_state: { stage: 7, approved_at: new Date().toISOString(), auto_approved: true },
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

async function runPhase1(pool: pg.Pool, actorId: string) {
  const state = loadState()
  if (state.phase1?.status === 'completed') {
    console.log('Phase 1 already completed:', state.phase1.migrationId)
    return state
  }

  const exclude = new Set(MISSING_BARCODES_PHASE1.map((b) => b.toLowerCase()))
  const rowCount = await buildFilteredXlsx(FIXED_FILE, PHASE1_FILE, exclude)
  console.log(`Built phase 1 file: ${rowCount} rows → ${PHASE1_FILE}`)

  const project = await createMigrationProject(pool, {
    name: `Palace Sales Phase 1 (${new Date().toISOString().slice(0, 10)})`,
    description: `Auto-migration: ${rowCount} sales rows with known products. Phase 2 deferred: ${MISSING_BARCODES_PHASE1.length} barcodes.`,
    createdBy: actorId,
  })
  console.log('Created migration project:', project.id)

  const buffer = readFileSync(PHASE1_FILE)
  await attachMigrationFile(pool, {
    migrationId: project.id,
    filename: 'migration-sales-PHASE1.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
    entityType: 'sales',
    actorId,
  })

  const final = await runPipeline(pool, project.id, actorId)
  console.log('Phase 1 final status:', final?.status, final?.reconciliation)

  state.phase1 = {
    migrationId: project.id,
    projectName: project.name,
    rowCount,
    completedAt: final?.completed_at ?? undefined,
    status: final?.status,
  }
  state.deferredBarcodes = MISSING_BARCODES_PHASE1
  saveState(state)
  return state
}

async function runPhase2(pool: pg.Pool, actorId: string) {
  const state = loadState()
  const sourcePath = readFileSync(CORRECTION_FILE) ? CORRECTION_FILE : FIXED_FILE

  const { rows: products } = await pool.query<{ barcode: string }>(
    `SELECT barcode FROM public.products WHERE deleted_at IS NULL AND barcode IS NOT NULL`
  )
  const known = new Set(products.map((p) => normalizeBarcode(p.barcode).toLowerCase()))

  const stillMissing = MISSING_BARCODES_PHASE1.filter((b) => !known.has(b.toLowerCase()))
  if (stillMissing.length) {
    throw new Error(
      `${stillMissing.length} deferred barcodes still missing from production — add products first:\n` +
        stillMissing.join(', ')
    )
  }

  const includeOnly = new Set(MISSING_BARCODES_PHASE1.map((b) => b.toLowerCase()))
  const { rows } = await parseWorkbook(readFileSync(sourcePath))
  const phase2Rows = rows.filter((r) => {
    const code = normalizeBarcode(r.code ?? r.Code).toLowerCase()
    return code && includeOnly.has(code)
  })

  if (!phase2Rows.length) {
    throw new Error('No phase-2 rows found in correction file — ensure updated file is in sales migration folder')
  }

  const phase2Path = resolve(SALES_DIR, 'migration-sales-PHASE2.xlsx')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  const cols = ['description', 'code', 'qty', 'store_name', 'TCostEx', 'report_month', 'paid'] as const
  ws.addRow([...cols])
  for (const r of phase2Rows) {
    const branch = String(r.BRANCH ?? r.branch ?? '').trim()
    const storeName = String(r.store_name ?? '').trim()
    const outlet = branch || (storeName.toUpperCase() === 'PALACE MALL' ? '' : storeName)
    const reportMonth =
      ddMmYyyyToReportMonth(r.report_month) ??
      (String(r.report_month ?? '').match(/^\d{4}-\d{2}-\d{2}/) ? String(r.report_month).slice(0, 10) : null)
    const code = normalizeBarcode(r.code ?? r.Code)
    const normalized = {
      description: code,
      code,
      qty: r.qty ?? r.Qty,
      store_name: outlet,
      TCostEx: r.TCostEx,
      report_month: reportMonth,
      paid: r.paid ?? '',
    }
    ws.addRow(cols.map((c) => normalized[c as keyof typeof normalized] ?? ''))
  }
  await wb.xlsx.writeFile(phase2Path)

  const project = await createMigrationProject(pool, {
    name: `Palace Sales Phase 2 (${new Date().toISOString().slice(0, 10)})`,
    description: `Deferred sales rows after product catalog correction (${phase2Rows.length} rows).`,
    createdBy: actorId,
  })

  await attachMigrationFile(pool, {
    migrationId: project.id,
    filename: 'migration-sales-PHASE2.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: readFileSync(phase2Path),
    entityType: 'sales',
    actorId,
  })

  const final = await runPipeline(pool, project.id, actorId)
  state.phase2 = {
    migrationId: project.id,
    projectName: project.name,
    rowCount: phase2Rows.length,
    completedAt: final?.completed_at ?? undefined,
    status: final?.status,
  }
  state.deferredBarcodes = []
  saveState(state)
  console.log('Phase 2 complete:', final?.status)
  return state
}

async function main() {
  const phase = process.argv.find((a) => a === 'phase1' || a === 'phase2') ?? 'phase1'
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const actorId = await getActorId(pool)
  console.log('Actor:', actorId, '| Phase:', phase)

  try {
    if (phase === 'phase2') {
      await runPhase2(pool, actorId)
    } else {
      await runPhase1(pool, actorId)
    }
    console.log('State saved:', STATE_FILE)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
