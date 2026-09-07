/**
 * Import AUTO discrepancy fixes into production:
 *   1. INTAKE-GAPS-READY.xlsx  → historical migration (intakes)
 *   2. DELIVERY-GAPS-READY.xlsx → historical migration (deliveries)
 *   3. INVENTORY-RECONCILE-READY.xlsx → direct supermarket_inventory set
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/run-discrepancy-fix-import.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/run-discrepancy-fix-import.ts dotenv_config_path=.env.local --apply-ready
 *   npx tsx -r dotenv/config scripts/run-discrepancy-fix-import.ts dotenv_config_path=.env.local --from-db --apply-ready
 *
 * --apply-ready  Import even after a prior completed run.
 * --from-db      Build AUTO rows from production (skips locked *-READY.xlsx files).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
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
import { migrationStr, writeFixedMigrationWorkbook } from '@/lib/migration/fix-workbook'
import {
  buildDeliveryFixRows,
  buildIntakeFixRows,
  buildInventoryFixRows,
} from '@/lib/migration/discrepancy-auto-fix'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const FIX_DIR = resolve(process.cwd(), 'discrepancies fix')
const STATE_FILE = resolve(FIX_DIR, 'discrepancy-import-state.json')

const INTAKE_READY = resolve(FIX_DIR, 'INTAKE-GAPS-READY.xlsx')
const DELIVERY_READY = resolve(FIX_DIR, 'DELIVERY-GAPS-READY.xlsx')
const INVENTORY_READY = resolve(FIX_DIR, 'INVENTORY-RECONCILE-READY.xlsx')

const INTAKE_UPLOAD = resolve(FIX_DIR, 'INTAKE-GAPS-UPLOAD.xlsx')
const DELIVERY_UPLOAD = resolve(FIX_DIR, 'DELIVERY-GAPS-UPLOAD.xlsx')

const INTAKE_COLS = ['vendor_name', 'product_name', 'quantity', 'received_date', 'barcode', 'notes'] as const
const DELIVERY_COLS = [
  'supermarket_name',
  'product_name',
  'quantity',
  'delivery_date',
  'branch',
  'store_code',
  'barcode',
] as const

const WIZARD_STRIP = new Set(['fix_status', 'review_flag'])

type ImportState = {
  migrationIds?: string[]
  intakesImported?: number
  deliveriesImported?: number
  inventoryAdjusted?: number
  inventorySkipped?: number
  status?: string
  completedAt?: string
  lastBatchAt?: string
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

function loadState(): ImportState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as ImportState
  } catch {
    return {}
  }
}

function saveState(state: ImportState) {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function stripWizardColumns(row: Record<string, unknown>, cols: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const col of cols) out[col] = row[col] ?? ''
  return out
}

function isAutoReadyRow(row: Record<string, unknown>) {
  const status = migrationStr(row.fix_status)
  return !status || status === 'AUTO'
}

async function loadReadyRows(inputPath: string): Promise<Record<string, unknown>[]> {
  if (!existsSync(inputPath)) return []
  const { rows } = await parseWorkbook(readFileSync(inputPath))
  return rows.filter(isAutoReadyRow)
}

async function buildUploadFile(
  readyRows: Record<string, unknown>[],
  outputPath: string,
  cols: readonly string[],
  dateColumns: readonly string[]
): Promise<Record<string, unknown>[]> {
  const cleanRows = readyRows.map((row) => {
    const stripped = { ...row }
    for (const k of WIZARD_STRIP) delete stripped[k]
    return stripWizardColumns(stripped, cols)
  })

  if (!cleanRows.length) return []

  await writeFixedMigrationWorkbook({
    outputPath,
    dataColumns: cols,
    dateColumns,
    rows: cleanRows,
    legend: [],
    columnWidths: { product_name: 42, barcode: 16, notes: 48 },
  })
  return cleanRows
}

function removeIfExists(path: string) {
  if (existsSync(path)) unlinkSync(path)
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

async function startImport(pool: pg.Pool, migrationId: string, actorId: string, entities: MigrationEntityType[]) {
  let totalEligible = 0
  for (const entity of entities) {
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

async function runMigrationPipeline(
  pool: pg.Pool,
  migrationId: string,
  actorId: string,
  importEntities: MigrationEntityType[]
) {
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
      `SELECT entity_type, row_number, errors FROM public.migration_staging_rows
       WHERE migration_id = $1 AND validation_status = 'error' ORDER BY entity_type, row_number LIMIT 15`,
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
      import_order: importEntities,
    },
    actorId,
    'migration.approved'
  )

  await startImport(pool, migrationId, actorId, importEntities)
  await drainJobs(pool, migrationId)

  const jobs = await listJobs(pool, migrationId)
  const failed = jobs.filter((j) => j.status === 'failed')
  if (failed.length) {
    console.error('Failed jobs:', failed.map((j) => ({ type: j.job_type, entity: j.entity_type, error: j.error_message })))
    throw new Error('Import jobs failed — see logs above')
  }

  return getMigrationProject(pool, migrationId)
}

async function applyInventoryAdjustments(
  pool: pg.Pool,
  spintexId: string,
  rows: Record<string, unknown>[]
) {
  const client = await pool.connect()
  let adjusted = 0
  let skipped = 0

  try {
    await client.query('BEGIN')

    for (const row of rows) {
      const bc = migrationStr(row.barcode)
      const suggested = Number(row.suggested_inventory)
      if (!bc || !Number.isFinite(suggested)) continue

      const { rows: products } = await client.query<{ id: string }>(
        `SELECT id FROM products WHERE deleted_at IS NULL AND barcode = $1 LIMIT 1`,
        [bc]
      )
      const productId = products[0]?.id
      if (!productId) throw new Error(`Product not found for barcode ${bc}`)

      const { rows: existing } = await client.query<{ id: string; quantity: number }>(
        `SELECT id, quantity FROM supermarket_inventory
         WHERE supermarket_id = $1::uuid AND product_id = $2::uuid
         FOR UPDATE`,
        [spintexId, productId]
      )

      if (existing[0] && Number(existing[0].quantity) === suggested) {
        skipped++
        continue
      }

      if (existing[0]) {
        await client.query(
          `UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`,
          [existing[0].id, Math.max(0, suggested)]
        )
      } else {
        await client.query(
          `INSERT INTO supermarket_inventory (supermarket_id, product_id, quantity)
           VALUES ($1::uuid, $2::uuid, $3)`,
          [spintexId, productId, Math.max(0, suggested)]
        )
      }

      console.log(
        'Inventory:',
        migrationStr(row.product_name),
        bc,
        `${existing[0]?.quantity ?? 0} → ${suggested}`
      )
      adjusted++
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  return { adjusted, skipped }
}

async function countImported(pool: pg.Pool, migrationId: string, entity: MigrationEntityType) {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM migration_staging_rows
     WHERE migration_id = $1 AND entity_type = $2 AND production_id IS NOT NULL`,
    [migrationId, entity]
  )
  return rows[0].c
}

async function loadAutoRowsFromDb(pool: pg.Pool) {
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex supermarket not found')
  const products = await loadStockChainProducts(pool, spintexId)
  const intake = buildIntakeFixRows(products).rows.filter((r) => r.fix_status === 'AUTO')
  const delivery = buildDeliveryFixRows(products).rows.filter((r) => r.fix_status === 'AUTO')
  const inventory = buildInventoryFixRows(products).rows.filter((r) => r.fix_status === 'AUTO')
  return { intake, delivery, inventory, spintexId }
}

async function main() {
  const applyReady = process.argv.includes('--apply-ready')
  const fromDb = process.argv.includes('--from-db')
  const state = loadState()

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  let intakeReadyRows: Record<string, unknown>[] = []
  let deliveryReadyRows: Record<string, unknown>[] = []
  let inventoryReadyRows: Record<string, unknown>[] = []
  let spintexId: string

  if (fromDb) {
    const built = await loadAutoRowsFromDb(pool)
    intakeReadyRows = built.intake
    deliveryReadyRows = built.delivery
    inventoryReadyRows = built.inventory
    spintexId = built.spintexId
    console.log('AUTO rows from production DB:', {
      intakes: intakeReadyRows.length,
      deliveries: deliveryReadyRows.length,
      inventory: inventoryReadyRows.length,
    })
  } else {
    intakeReadyRows = await loadReadyRows(INTAKE_READY)
    deliveryReadyRows = await loadReadyRows(DELIVERY_READY)
    inventoryReadyRows = await loadReadyRows(INVENTORY_READY)
    const resolved = await resolvePalaceSpintexId(pool)
    if (!resolved) throw new Error('Palace Spintex supermarket not found')
    spintexId = resolved
  }

  if (!intakeReadyRows.length && !deliveryReadyRows.length && !inventoryReadyRows.length) {
    console.log(fromDb ? 'No AUTO discrepancy rows to apply from DB.' : 'No *-READY.xlsx rows to apply.')
    await pool.end()
    return
  }

  if (
    !applyReady &&
    !fromDb &&
    state.status === 'completed' &&
    !intakeReadyRows.length &&
    !deliveryReadyRows.length &&
    !inventoryReadyRows.length
  ) {
    console.log('Discrepancy fix import already completed:', state)
    await pool.end()
    return
  }

  const intakeRows = intakeReadyRows.length
    ? await buildUploadFile(intakeReadyRows, INTAKE_UPLOAD, INTAKE_COLS, ['received_date'])
    : []
  const deliveryRows = deliveryReadyRows.length
    ? await buildUploadFile(deliveryReadyRows, DELIVERY_UPLOAD, DELIVERY_COLS, ['delivery_date'])
    : []

  console.log('Rows to apply:', {
    intakes: intakeRows.length,
    deliveries: deliveryRows.length,
    inventory: inventoryReadyRows.length,
  })

  const actorId = await getActorId(pool)

  console.log('Actor:', actorId, '| Spintex:', spintexId)

  const batch = {
    intakesImported: 0,
    deliveriesImported: 0,
    inventoryAdjusted: 0,
    inventorySkipped: 0,
    migrationId: null as string | null,
  }

  try {
    if (intakeRows.length || deliveryRows.length) {
      const project = await createMigrationProject(pool, {
        name: `Discrepancy AUTO fixes (${new Date().toISOString().slice(0, 10)})`,
        description: `Palace Spintex discrepancy AUTO batch — ${intakeRows.length} intakes, ${deliveryRows.length} deliveries`,
        createdBy: actorId,
      })
      console.log('Created migration project:', project.id)
      batch.migrationId = project.id

      if (intakeRows.length) {
        await attachMigrationFile(pool, {
          migrationId: project.id,
          filename: 'INTAKE-GAPS-UPLOAD.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: readFileSync(INTAKE_UPLOAD),
          entityType: 'intakes',
          actorId,
        })
      }

      if (deliveryRows.length) {
        await attachMigrationFile(pool, {
          migrationId: project.id,
          filename: 'DELIVERY-GAPS-UPLOAD.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: readFileSync(DELIVERY_UPLOAD),
          entityType: 'deliveries',
          actorId,
        })
      }

      const importEntities = (
        intakeRows.length && deliveryRows.length
          ? ['intakes', 'deliveries']
          : intakeRows.length
            ? ['intakes']
            : ['deliveries']
      ) as MigrationEntityType[]

      const final = await runMigrationPipeline(pool, project.id, actorId, importEntities)
      batch.intakesImported = intakeRows.length ? await countImported(pool, project.id, 'intakes') : 0
      batch.deliveriesImported = deliveryRows.length ? await countImported(pool, project.id, 'deliveries') : 0

      console.log('Migration final status:', final?.status)
      console.log('Reconciliation:', final?.reconciliation)
      console.log('Imported this batch:', {
        intakes: batch.intakesImported,
        deliveries: batch.deliveriesImported,
      })
    }

    if (inventoryReadyRows.length) {
      const inv = await applyInventoryAdjustments(pool, spintexId, inventoryReadyRows)
      batch.inventoryAdjusted = inv.adjusted
      batch.inventorySkipped = inv.skipped
      console.log('Inventory adjustments:', inv)
    }

    const legacyMigrationIds = state.migrationIds ?? (state as { migrationId?: string }).migrationId
      ? [(state as { migrationId?: string }).migrationId!]
      : []

    saveState({
      migrationIds: batch.migrationId ? [...legacyMigrationIds, batch.migrationId] : legacyMigrationIds,
      intakesImported: (state.intakesImported ?? 0) + batch.intakesImported,
      deliveriesImported: (state.deliveriesImported ?? 0) + batch.deliveriesImported,
      inventoryAdjusted: (state.inventoryAdjusted ?? 0) + batch.inventoryAdjusted,
      inventorySkipped: (state.inventorySkipped ?? 0) + batch.inventorySkipped,
      status: 'completed',
      completedAt: new Date().toISOString(),
      lastBatchAt: new Date().toISOString(),
    })

    removeIfExists(INTAKE_READY)
    removeIfExists(DELIVERY_READY)
    removeIfExists(INVENTORY_READY)
    if (!fromDb) {
      removeIfExists(INTAKE_UPLOAD)
      removeIfExists(DELIVERY_UPLOAD)
      console.log('\nRemoved *-READY.xlsx and *-UPLOAD.xlsx from discrepancies fix/')
    } else {
      console.log('\nApplied from DB (--from-db). Regenerate workbooks when Excel files are closed.')
    }
    console.log('State saved to', STATE_FILE)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
