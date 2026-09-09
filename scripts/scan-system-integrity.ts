/**
 * Full production database integrity scan.
 * Usage: npx tsx -r dotenv/config scripts/scan-system-integrity.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import pg from 'pg'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'
import {
  buildChronologyIssues,
  buildDeliveryFixRows,
  buildIntakeFixRows,
  buildInventoryFixRows,
  countByDisposition,
} from '@/lib/migration/discrepancy-auto-fix'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

type Issue = { severity: 'error' | 'warn' | 'info'; area: string; message: string; count?: number }

const issues: Issue[] = []

function report(severity: Issue['severity'], area: string, message: string, count?: number) {
  issues.push({ severity, area, message, count })
}

async function main() {
  console.log('=== FULL SYSTEM INTEGRITY SCAN ===')
  console.log('Database:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') ?? '(none)')
  console.log('Time:', new Date().toISOString())

  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) report('error', 'config', 'Palace Spintex supermarket not found')
  else report('info', 'config', `Palace Spintex id ${spintexId}`)

  // ─── Discrepancy engine (same logic as workbooks) ───
  if (spintexId) {
    const products = await loadStockChainProducts(pool, spintexId)
    const intake = buildIntakeFixRows(products)
    const delivery = buildDeliveryFixRows(products)
    const inventory = buildInventoryFixRows(products)
    const chronology = buildChronologyIssues(products, delivery.autoBarcodes)

    const intakeC = countByDisposition(intake.meta)
    const deliveryC = countByDisposition(delivery.meta)
    const inventoryC = countByDisposition(inventory.meta)
    const chronologyC = countByDisposition(chronology.map((c) => c.meta))

    const autoTotal = intakeC.auto + deliveryC.auto + inventoryC.auto + chronologyC.auto
    const adminTotal = intakeC.admin + deliveryC.admin + inventoryC.admin + chronologyC.admin

    if (autoTotal) report('warn', 'discrepancies', `AUTO fix rows pending: intake=${intakeC.auto} delivery=${deliveryC.auto} inventory=${inventoryC.auto} chronology=${chronologyC.auto}`, autoTotal)
    else report('info', 'discrepancies', 'No AUTO discrepancy fix rows (intake/delivery/inventory/chronology)')

    if (adminTotal) report('warn', 'discrepancies', `ADMIN review rows: intake=${intakeC.admin} delivery=${deliveryC.admin} inventory=${inventoryC.admin} chronology=${chronologyC.admin}`, adminTotal)
    else report('info', 'discrepancies', 'No ADMIN discrepancy review rows')
  }

  // ─── Deliveries ───
  const { rows: unconfirmed } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM delivery_runs WHERE deleted_at IS NULL AND confirmed_at IS NULL`
  )
  if (unconfirmed[0].c > 0) report('warn', 'deliveries', 'Unconfirmed delivery runs', unconfirmed[0].c)
  else report('info', 'deliveries', 'All delivery runs confirmed')

  const { rows: negInv } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM supermarket_inventory WHERE quantity < 0`
  )
  if (negInv[0].c > 0) report('error', 'inventory', 'Negative supermarket_inventory rows', negInv[0].c)
  else report('info', 'inventory', 'No negative shelf inventory')

  // ─── Catalog ───
  const { rows: noBarcode } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM products WHERE deleted_at IS NULL AND (barcode IS NULL OR trim(barcode) = '')`
  )
  if (noBarcode[0].c > 0) report('info', 'catalog', 'Active products without barcode', noBarcode[0].c)

  const { rows: dupBc } = await pool.query<{ barcode: string; c: number }>(
    `SELECT barcode, COUNT(*)::int c FROM products
     WHERE deleted_at IS NULL AND barcode IS NOT NULL AND trim(barcode) <> ''
     GROUP BY barcode HAVING COUNT(*) > 1`
  )
  if (dupBc.length) report('error', 'catalog', `Duplicate barcodes: ${dupBc.map((r) => r.barcode).join(', ')}`, dupBc.length)

  const { rows: zeroPrice } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM products
     WHERE deleted_at IS NULL AND (vendor_price IS NULL OR vendor_price <= 0)`
  )
  if (zeroPrice[0].c > 0) report('warn', 'catalog', 'Products with missing/zero vendor_price', zeroPrice[0].c)

  // ─── Payouts ───
  const { rows: badPayouts } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM payouts
     WHERE deleted_at IS NULL AND status = 'completed'
       AND COALESCE(amount_paid, 0) < amount_due`
  )
  if (badPayouts[0].c > 0) report('error', 'payouts', 'Completed payouts not fully paid', badPayouts[0].c)
  else report('info', 'payouts', 'No completed payouts under-paid')

  // ─── Migrations ───
  const { rows: stuckMigrations } = await pool.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM migration_projects
     WHERE status NOT IN ('completed', 'cancelled', 'draft')
     ORDER BY updated_at DESC LIMIT 10`
  )
  if (stuckMigrations.length) {
    report('warn', 'migrations', `Non-completed migration projects: ${stuckMigrations.map((m) => `${m.status}:${m.name.slice(0, 40)}`).join('; ')}`, stuckMigrations.length)
  } else report('info', 'migrations', 'No in-progress migration projects')

  const { rows: failedJobs } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM migration_jobs WHERE status = 'failed'`
  )
  if (failedJobs[0].c > 0) report('warn', 'migrations', 'Failed migration jobs (historical)', failedJobs[0].c)

  // ─── Referential sanity ───
  const { rows: orphanSales } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM sales s
     LEFT JOIN products p ON p.id = s.product_id AND p.deleted_at IS NULL
     WHERE s.deleted_at IS NULL AND p.id IS NULL`
  )
  if (orphanSales[0].c > 0) report('error', 'data', 'Sales referencing missing/deleted products', orphanSales[0].c)

  const { rows: orphanIntakes } = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int c FROM intakes i
     LEFT JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
     WHERE i.deleted_at IS NULL AND p.id IS NULL`
  )
  if (orphanIntakes[0].c > 0) report('error', 'data', 'Intakes referencing missing/deleted products', orphanIntakes[0].c)

  // ─── Operational counts ───
  const { rows: counts } = await pool.query<{
    vendors: number
    products: number
    intakes: number
    delivery_runs: number
    sales: number
    returns: number
    payouts: number
  }>(
    `SELECT
      (SELECT COUNT(*)::int FROM vendors WHERE deleted_at IS NULL) AS vendors,
      (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL) AS products,
      (SELECT COUNT(*)::int FROM intakes WHERE deleted_at IS NULL) AS intakes,
      (SELECT COUNT(*)::int FROM delivery_runs WHERE deleted_at IS NULL) AS delivery_runs,
      (SELECT COUNT(*)::int FROM sales WHERE deleted_at IS NULL) AS sales,
      (SELECT COUNT(*)::int FROM product_returns WHERE deleted_at IS NULL) AS returns,
      (SELECT COUNT(*)::int FROM payouts WHERE deleted_at IS NULL) AS payouts`
  )
  console.log('\n=== OPERATIONAL RECORD COUNTS ===')
  console.log(counts[0])

  // ─── Report ───
  const errors = issues.filter((i) => i.severity === 'error')
  const warns = issues.filter((i) => i.severity === 'warn')
  const infos = issues.filter((i) => i.severity === 'info')

  console.log('\n=== FINDINGS ===')
  for (const i of [...errors, ...warns, ...infos]) {
    const prefix = i.severity === 'error' ? 'ERROR' : i.severity === 'warn' ? 'WARN ' : 'OK   '
    console.log(`${prefix} [${i.area}] ${i.message}${i.count != null ? ` (${i.count})` : ''}`)
  }

  console.log('\n=== VERDICT ===')
  if (errors.length) {
    console.log(`NOT SOLID — ${errors.length} error(s), ${warns.length} warning(s)`)
    process.exitCode = 1
  } else if (warns.length) {
    console.log(`FUNCTIONAL with ${warns.length} warning(s) — no blocking errors`)
  } else {
    console.log('SOLID — stock chain balanced, no blocking integrity issues')
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
