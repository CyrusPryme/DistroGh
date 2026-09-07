/**
 * Generate discrepancy fix workbooks with safe auto-fixes applied and admin rows flagged.
 *
 * Usage: npx tsx -r dotenv/config scripts/generate-discrepancy-fix-workbooks.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { resolve } from 'node:path'
import { unlinkSync, existsSync } from 'node:fs'
import { Pool } from 'pg'
import {
  printFixSummary,
  writeFixedMigrationWorkbook,
  type MigrationReviewLegendRow,
} from '@/lib/migration/fix-workbook'
import {
  buildChronologyIssues,
  buildDeliveryFixRows,
  buildIntakeFixRows,
  buildInventoryFixRows,
  countByDisposition,
  type DiscrepancyRowMeta,
} from '@/lib/migration/discrepancy-auto-fix'
import {
  CHRONOLOGY_LEGEND_EXAMPLES,
  DELIVERY_GAPS_LEGEND_EXAMPLES,
  DISCREPANCY_SUMMARY_LEGEND_EXAMPLES,
  INTAKE_GAPS_LEGEND_EXAMPLES,
  INVENTORY_LEGEND_EXAMPLES,
} from '@/lib/migration/discrepancy-legend-examples'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const OUT_DIR = resolve(process.cwd(), 'discrepancies fix')

const LEGEND: MigrationReviewLegendRow[] = [
  {
    colorLabel: '(no fill)',
    meaning: 'AUTO — safe fix applied with standard assumptions (median lag, deterministic qty)',
    adminAction: 'Review optional; rows in *-READY.xlsx are ready to import or apply',
  },
  {
    colorLabel: 'Rose (pink)',
    meaning: 'ADMIN — hard blocker (missing barcode); delivery gaps are AUTO when Spintex sales/returns exist',
    adminAction: 'Fix catalog barcode before import',
  },
  {
    colorLabel: 'Amber (yellow)',
    meaning: 'ADMIN — chronology or intake date conflicts only',
    adminAction: 'Verify dates; delivery qty follows authoritative Spintex sales',
  },
  {
    colorLabel: 'Red',
    meaning: 'BLOCKED — missing barcode/vendor',
    adminAction: 'Fix catalog first',
  },
]

function highlightFromMeta(meta: DiscrepancyRowMeta[]) {
  return (_row: Record<string, unknown>, i: number) => {
    const m = meta[i]
    if (!m || m.disposition === 'auto') return null
    return { kind: m.kind ?? 'amber', reviewFlag: m.reviewFlag }
  }
}

function filterReady(rows: Record<string, unknown>[]) {
  return rows.filter((r) => r.fix_status === 'AUTO')
}

async function writeWorkbookPair(
  fullPath: string,
  readyPath: string,
  params: Parameters<typeof writeFixedMigrationWorkbook>[0],
  meta: DiscrepancyRowMeta[]
) {
  const { highlightedByKind } = await writeFixedMigrationWorkbook({
    ...params,
    outputPath: fullPath,
    getHighlight: highlightFromMeta(meta),
    alwaysIncludeReviewFlag: true,
  })

  const readyRows = filterReady(params.rows)
  if (readyRows.length) {
    await writeFixedMigrationWorkbook({
      ...params,
      outputPath: readyPath,
      rows: readyRows,
      legend: params.legend,
      getHighlight: () => null,
      alwaysIncludeReviewFlag: true,
    })
  } else if (existsSync(readyPath)) {
    unlinkSync(readyPath)
  }

  return { highlightedByKind, readyCount: readyRows.length }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex supermarket not found in production')

  const products = await loadStockChainProducts(pool, spintexId)
  await pool.end()

  const intake = buildIntakeFixRows(products)
  const delivery = buildDeliveryFixRows(products)
  const inventory = buildInventoryFixRows(products)
  const chronologyIssues = buildChronologyIssues(products, delivery.autoBarcodes)
  const chronologyRows = chronologyIssues.map(({ meta: _m, ...row }) => row)
  const chronologyMeta = chronologyIssues.map((i) => i.meta)

  const intakeCounts = countByDisposition(intake.meta)
  const deliveryCounts = countByDisposition(delivery.meta)
  const inventoryCounts = countByDisposition(inventory.meta)
  const chronologyCounts = countByDisposition(chronologyMeta)

  const summaryRows = [
    {
      category: 'Intake gaps',
      total: intake.rows.length,
      auto_fixed: intakeCounts.auto,
      admin_review: intakeCounts.admin,
      fix_workbook: 'INTAKE-GAPS-FIX.xlsx',
      ready_workbook: 'INTAKE-GAPS-READY.xlsx',
      fix_action: 'Import AUTO rows via Historical Migrations → intakes',
    },
    {
      category: 'Delivery gaps',
      total: delivery.rows.length,
      auto_fixed: deliveryCounts.auto,
      admin_review: deliveryCounts.admin,
      fix_workbook: 'DELIVERY-GAPS-FIX.xlsx',
      ready_workbook: 'DELIVERY-GAPS-READY.xlsx',
      fix_action: 'Import AUTO supplemental deliveries (partial gaps only)',
    },
    {
      category: 'Shelf inventory',
      total: inventory.rows.length,
      auto_fixed: inventoryCounts.auto,
      admin_review: inventoryCounts.admin,
      fix_workbook: 'INVENTORY-RECONCILE-FIX.xlsx',
      ready_workbook: 'INVENTORY-RECONCILE-READY.xlsx',
      fix_action: 'Apply AUTO adjustment_qty to supermarket_inventory (Spintex)',
    },
    {
      category: 'Chronology',
      total: chronologyRows.length,
      auto_fixed: chronologyCounts.auto,
      admin_review: chronologyCounts.admin,
      fix_workbook: 'CHRONOLOGY-FIX.xlsx',
      ready_workbook: '(resolved by delivery/intake READY files)',
      fix_action: 'AUTO rows resolved by other READY workbooks',
    },
  ]

  const intakeResult = await writeWorkbookPair(
    resolve(OUT_DIR, 'INTAKE-GAPS-FIX.xlsx'),
    resolve(OUT_DIR, 'INTAKE-GAPS-READY.xlsx'),
    {
      outputPath: '',
      dataColumns: ['fix_status', 'vendor_name', 'product_name', 'quantity', 'received_date', 'barcode', 'notes'],
      dateColumns: ['received_date'],
      rows: intake.rows,
      legend: LEGEND,
      legendExamples: INTAKE_GAPS_LEGEND_EXAMPLES,
      columnWidths: { product_name: 42, notes: 40, review_flag: 72, fix_status: 14 },
    },
    intake.meta
  )

  const deliveryResult = await writeWorkbookPair(
    resolve(OUT_DIR, 'DELIVERY-GAPS-FIX.xlsx'),
    resolve(OUT_DIR, 'DELIVERY-GAPS-READY.xlsx'),
    {
      outputPath: '',
      dataColumns: [
        'fix_status',
        'supermarket_name',
        'product_name',
        'quantity',
        'delivery_date',
        'branch',
        'store_code',
        'barcode',
        'sold_spintex',
        'returned_spintex',
        'delivered_spintex',
        'delivered_palace_other',
      ],
      dateColumns: ['delivery_date'],
      rows: delivery.rows,
      legend: LEGEND,
      legendExamples: DELIVERY_GAPS_LEGEND_EXAMPLES,
      columnWidths: { product_name: 42, review_flag: 72, fix_status: 14 },
    },
    delivery.meta
  )

  const inventoryResult = await writeWorkbookPair(
    resolve(OUT_DIR, 'INVENTORY-RECONCILE-FIX.xlsx'),
    resolve(OUT_DIR, 'INVENTORY-RECONCILE-READY.xlsx'),
    {
      outputPath: '',
      dataColumns: [
        'fix_status',
        'product_name',
        'barcode',
        'delivered_spintex',
        'delivered_palace_other',
        'sold_spintex',
        'returned_spintex',
        'expected_shelf',
        'implied_expected_shelf',
        'current_inventory',
        'suggested_inventory',
        'adjustment_qty',
      ],
      rows: inventory.rows,
      legend: LEGEND,
      legendExamples: INVENTORY_LEGEND_EXAMPLES,
      columnWidths: { product_name: 42, review_flag: 80, fix_status: 14 },
    },
    inventory.meta
  )

  await writeFixedMigrationWorkbook({
    outputPath: resolve(OUT_DIR, 'CHRONOLOGY-FIX.xlsx'),
    dataColumns: [
      'fix_status',
      'issue_type',
      'product_name',
      'barcode',
      'record_entity',
      'current_date',
      'reference_date',
      'suggested_date',
      'fix_action',
    ],
    dateColumns: ['current_date', 'reference_date', 'suggested_date'],
    rows: chronologyIssues.map((issue) => ({
      fix_status: issue.meta.disposition === 'auto' ? 'AUTO' : 'ADMIN REVIEW',
      issue_type: issue.issue_type,
      product_name: issue.product_name,
      barcode: issue.barcode,
      record_entity: issue.record_entity,
      current_date: issue.current_date,
      reference_date: issue.reference_date,
      suggested_date: issue.suggested_date,
      fix_action: issue.fix_action,
    })),
    legend: LEGEND,
    legendExamples: CHRONOLOGY_LEGEND_EXAMPLES,
    getHighlight: highlightFromMeta(chronologyMeta),
    columnWidths: { product_name: 40, fix_action: 56, review_flag: 72, fix_status: 14 },
    alwaysIncludeReviewFlag: true,
  })

  await writeFixedMigrationWorkbook({
    outputPath: resolve(OUT_DIR, 'DISCREPANCY-SUMMARY.xlsx'),
    dataColumns: [
      'category',
      'total',
      'auto_fixed',
      'admin_review',
      'fix_workbook',
      'ready_workbook',
      'fix_action',
    ],
    rows: summaryRows,
    legend: [
      {
        colorLabel: 'Start here',
        meaning: 'AUTO = safe deterministic fix; ADMIN = needs confirmation before import',
        adminAction: 'Import *-READY.xlsx rows first, then resolve highlighted ADMIN rows in *-FIX.xlsx',
      },
    ],
    legendExamples: DISCREPANCY_SUMMARY_LEGEND_EXAMPLES,
    columnWidths: { category: 22, fix_action: 52, fix_workbook: 28, ready_workbook: 32 },
  })

  console.log('=== DISCREPANCY FIX WORKBOOKS (auto + admin) ===')
  console.log('Output:', OUT_DIR)
  console.log('Products analyzed:', products.length)
  console.log('\nAuto-fix counts:', {
    intake: intakeCounts,
    delivery: deliveryCounts,
    inventory: inventoryCounts,
    chronology: chronologyCounts,
  })
  console.log('\nREADY row counts:', {
    intake: intakeResult.readyCount,
    delivery: deliveryResult.readyCount,
    inventory: inventoryResult.readyCount,
  })

  printFixSummary({
    title: 'INTAKE GAPS',
    inputPath: '(production DB)',
    outputPath: resolve(OUT_DIR, 'INTAKE-GAPS-FIX.xlsx'),
    inputRows: products.length,
    outputRows: intake.rows.length,
    highlightedByKind: intakeResult.highlightedByKind,
    extra: {
      'AUTO rows': intakeCounts.auto,
      'ADMIN rows': intakeCounts.admin,
    },
  })

  console.log('\nFiles: DISCREPANCY-SUMMARY.xlsx, *-FIX.xlsx (all), *-READY.xlsx (auto only)')
  console.log('Remove review_flag and fix_status before migration upload.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
