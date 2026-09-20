import type { Pool } from 'pg'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'
import {
  buildChronologyIssues,
  buildDeliveryFixRows,
  buildIntakeFixRows,
  buildInventoryFixRows,
  countByDisposition,
} from '@/lib/migration/discrepancy-auto-fix'

export type SystemIntegritySeverity = 'error' | 'warn' | 'info'

export type SystemIntegrityIssue = {
  severity: SystemIntegritySeverity
  area: string
  message: string
  count?: number
}

export type SystemIntegrityCounts = {
  vendors: number
  products: number
  intakes: number
  delivery_runs: number
  sales: number
  returns: number
  payouts: number
}

export type SystemIntegrityVerdict = 'solid' | 'functional' | 'not_solid'

export type SystemIntegrityResult = {
  issues: SystemIntegrityIssue[]
  counts: SystemIntegrityCounts
  verdict: SystemIntegrityVerdict
  checked_at: string
}

/**
 * Full-database integrity scan — the same checks that used to live only in the interactive
 * `scripts/scan-system-integrity.ts` CLI script, extracted so the Platform > Data Integrity
 * dashboard can run them on demand instead of an admin needing shell/DB access to know whether
 * anything is quietly wrong. Pure read-only queries; safe to run at any time.
 *
 * All of the independent checks below are fired via a single Promise.all rather than sequential
 * awaits: each `pool.query()` call is a full network round trip to Postgres (Neon, over the
 * internet), and this scan makes ~12 of them. Awaiting them one at a time stacks that round-trip
 * latency linearly (this genuinely took 3-5s in practice); running them concurrently costs
 * roughly one round trip's worth of wall-clock time instead.
 */
export async function runSystemIntegrityScan(pool: Pool): Promise<SystemIntegrityResult> {
  const issues: SystemIntegrityIssue[] = []
  const report = (severity: SystemIntegritySeverity, area: string, message: string, count?: number) => {
    issues.push({ severity, area, message, count })
  }

  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) report('error', 'config', 'Palace Spintex supermarket not found')
  else report('info', 'config', `Palace Spintex id ${spintexId}`)

  const [
    discrepancyProducts,
    overDelivered,
    unconfirmed,
    negInv,
    noBarcode,
    dupBc,
    zeroPrice,
    badPayouts,
    stuckMigrations,
    failedJobs,
    orphanSales,
    orphanIntakes,
    countsRows,
  ] = await Promise.all([
    spintexId ? loadStockChainProducts(pool, spintexId) : Promise.resolve(null),

    // ─── Over-delivery (all vendors, all-time — not just Palace Spintex) ───
    pool.query<{ c: number }>(
      `WITH recv AS (
         SELECT product_id, SUM(quantity_received)::int q FROM intakes WHERE deleted_at IS NULL GROUP BY product_id
       ),
       del AS (
         SELECT dri.product_id, SUM(dri.quantity_delivered)::int q
         FROM delivery_run_items dri
         JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
         GROUP BY dri.product_id
       )
       SELECT COUNT(*)::int c
       FROM products p
       LEFT JOIN recv r ON r.product_id = p.id
       LEFT JOIN del d ON d.product_id = p.id
       WHERE p.deleted_at IS NULL AND COALESCE(d.q, 0) > COALESCE(r.q, 0)`
    ),

    // ─── Deliveries ───
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM delivery_runs WHERE deleted_at IS NULL AND confirmed_at IS NULL`
    ),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int c FROM supermarket_inventory WHERE quantity < 0`),

    // ─── Catalog ───
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM products WHERE deleted_at IS NULL AND (barcode IS NULL OR trim(barcode) = '')`
    ),
    pool.query<{ barcode: string; c: number }>(
      `SELECT barcode, COUNT(*)::int c FROM products
       WHERE deleted_at IS NULL AND barcode IS NOT NULL AND trim(barcode) <> ''
       GROUP BY barcode HAVING COUNT(*) > 1`
    ),
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM products
       WHERE deleted_at IS NULL AND (vendor_price IS NULL OR vendor_price <= 0)`
    ),

    // ─── Payouts ───
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM payouts
       WHERE deleted_at IS NULL AND status = 'completed'
         AND COALESCE(amount_paid, 0) < amount_due`
    ),

    // ─── Migrations ───
    pool.query<{ id: string; name: string; status: string }>(
      `SELECT id, name, status FROM migration_projects
       WHERE status NOT IN ('completed', 'cancelled', 'draft', 'archived')
       ORDER BY updated_at DESC LIMIT 10`
    ),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int c FROM migration_jobs WHERE status = 'failed'`),

    // ─── Referential sanity ───
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM sales s
       LEFT JOIN products p ON p.id = s.product_id AND p.deleted_at IS NULL
       WHERE s.deleted_at IS NULL AND p.id IS NULL`
    ),
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int c FROM intakes i
       LEFT JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
       WHERE i.deleted_at IS NULL AND p.id IS NULL`
    ),

    // ─── Operational counts ───
    pool.query<SystemIntegrityCounts>(
      `SELECT
        (SELECT COUNT(*)::int FROM vendors WHERE deleted_at IS NULL) AS vendors,
        (SELECT COUNT(*)::int FROM products WHERE deleted_at IS NULL) AS products,
        (SELECT COUNT(*)::int FROM intakes WHERE deleted_at IS NULL) AS intakes,
        (SELECT COUNT(*)::int FROM delivery_runs WHERE deleted_at IS NULL) AS delivery_runs,
        (SELECT COUNT(*)::int FROM sales WHERE deleted_at IS NULL) AS sales,
        (SELECT COUNT(*)::int FROM product_returns WHERE deleted_at IS NULL) AS returns,
        (SELECT COUNT(*)::int FROM payouts WHERE deleted_at IS NULL) AS payouts`
    ),
  ])

  // ─── Discrepancy engine (same logic as workbooks) ───
  if (discrepancyProducts) {
    const intake = buildIntakeFixRows(discrepancyProducts)
    const delivery = buildDeliveryFixRows(discrepancyProducts)
    const inventory = buildInventoryFixRows(discrepancyProducts)
    const chronology = buildChronologyIssues(discrepancyProducts, delivery.autoBarcodes)

    const intakeC = countByDisposition(intake.meta)
    const deliveryC = countByDisposition(delivery.meta)
    const inventoryC = countByDisposition(inventory.meta)
    const chronologyC = countByDisposition(chronology.map((c) => c.meta))

    const autoTotal = intakeC.auto + deliveryC.auto + inventoryC.auto + chronologyC.auto
    const adminTotal = intakeC.admin + deliveryC.admin + inventoryC.admin + chronologyC.admin

    if (autoTotal) {
      report(
        'warn',
        'discrepancies',
        `AUTO fix rows pending: intake=${intakeC.auto} delivery=${deliveryC.auto} inventory=${inventoryC.auto} chronology=${chronologyC.auto}`,
        autoTotal
      )
    } else report('info', 'discrepancies', 'No AUTO discrepancy fix rows (intake/delivery/inventory/chronology)')

    if (adminTotal) {
      report(
        'warn',
        'discrepancies',
        `ADMIN review rows: intake=${intakeC.admin} delivery=${deliveryC.admin} inventory=${inventoryC.admin} chronology=${chronologyC.admin}`,
        adminTotal
      )
    } else report('info', 'discrepancies', 'No ADMIN discrepancy review rows')
  }

  if (overDelivered.rows[0].c > 0) {
    report(
      'error',
      'stock',
      'Products delivered more than ever received (all-time, all vendors) — see Vendor flow product breakdown for the warning icon',
      overDelivered.rows[0].c
    )
  } else report('info', 'stock', 'No product is delivered more than received (all vendors, all-time)')

  if (unconfirmed.rows[0].c > 0) report('warn', 'deliveries', 'Unconfirmed delivery runs', unconfirmed.rows[0].c)
  else report('info', 'deliveries', 'All delivery runs confirmed')

  if (negInv.rows[0].c > 0) report('error', 'inventory', 'Negative supermarket_inventory rows', negInv.rows[0].c)
  else report('info', 'inventory', 'No negative shelf inventory')

  if (noBarcode.rows[0].c > 0) report('info', 'catalog', 'Active products without barcode', noBarcode.rows[0].c)

  if (dupBc.rows.length) {
    report('error', 'catalog', `Duplicate barcodes: ${dupBc.rows.map((r) => r.barcode).join(', ')}`, dupBc.rows.length)
  }

  if (zeroPrice.rows[0].c > 0) report('warn', 'catalog', 'Products with missing/zero vendor_price', zeroPrice.rows[0].c)

  if (badPayouts.rows[0].c > 0) report('error', 'payouts', 'Completed payouts not fully paid', badPayouts.rows[0].c)
  else report('info', 'payouts', 'No completed payouts under-paid')

  if (stuckMigrations.rows.length) {
    report(
      'warn',
      'migrations',
      `Non-completed migration projects: ${stuckMigrations.rows.map((m) => `${m.status}:${m.name.slice(0, 40)}`).join('; ')}`,
      stuckMigrations.rows.length
    )
  } else report('info', 'migrations', 'No in-progress migration projects')

  if (failedJobs.rows[0].c > 0) report('warn', 'migrations', 'Failed migration jobs (historical)', failedJobs.rows[0].c)

  if (orphanSales.rows[0].c > 0) report('error', 'data', 'Sales referencing missing/deleted products', orphanSales.rows[0].c)

  if (orphanIntakes.rows[0].c > 0) {
    report('error', 'data', 'Intakes referencing missing/deleted products', orphanIntakes.rows[0].c)
  }

  const errors = issues.filter((i) => i.severity === 'error')
  const warns = issues.filter((i) => i.severity === 'warn')
  const verdict: SystemIntegrityVerdict = errors.length ? 'not_solid' : warns.length ? 'functional' : 'solid'

  return {
    issues,
    counts: countsRows.rows[0],
    verdict,
    checked_at: new Date().toISOString(),
  }
}
