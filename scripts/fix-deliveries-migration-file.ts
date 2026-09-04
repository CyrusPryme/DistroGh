/**
 * Fix Palace deliveries upload for historical migration wizard.
 *
 * See docs/MIGRATION-FIX-WORKBOOK.md for the standard fix workflow.
 *
 * Usage: npx tsx -r dotenv/config scripts/fix-deliveries-migration-file.ts dotenv_config_path=.env.local
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'
import { validateRow } from '@/lib/migration/validate'
import { detectEntityType } from '@/lib/migration/detect'
import { toSqlDate } from '@/lib/utils'
import {
  buildReviewFlag,
  loadCatalogByBarcode,
  migrationStr,
  printFixSummary,
  writeFixedMigrationWorkbook,
  type MigrationReviewHighlight,
  type MigrationReviewLegendRow,
} from '@/lib/migration/fix-workbook'
import {
  buildDeliveryRowsFromReturnsGaps,
  isGapSupplementRow,
} from '@/lib/migration/delivery-gap-rows'

const INPUT = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_ MAIDEN.xlsx')
const RETURNS_INPUT = resolve(process.cwd(), 'returned migration/returns-MAIDEN-FIXED.xlsx')
const OUTPUT = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx')

const DATA_COLS = [
  'supermarket_name',
  'product_name',
  'quantity',
  'delivery_date',
  'branch',
  'store_code',
  'barcode',
] as const

const LEGEND: MigrationReviewLegendRow[] = [
  {
    colorLabel: 'Amber (yellow)',
    meaning: 'Delivery date is before the earliest warehouse receipt for this product',
    adminAction: 'Correct delivery_date or confirm the date is intentional',
  },
  {
    colorLabel: 'Rose (pink)',
    meaning: 'Added from returns file — product had no delivery in maiden import; qty/date derived from return row',
    adminAction: 'Verify delivery quantity and date cover the return, then import',
  },
  {
    colorLabel: 'Red',
    meaning: 'Missing barcode or quantity — row cannot be imported',
    adminAction: 'Fix or remove the row',
  },
]

export async function fixDeliveriesRows(
  rows: Record<string, unknown>[],
  catalogByBarcode: Map<string, string>
): Promise<{ fixedRows: Record<string, unknown>[]; dropped: number; dateFixed: number; nameFixed: number }> {
  const fixedRows: Record<string, unknown>[] = []
  let dropped = 0
  let dateFixed = 0
  let nameFixed = 0

  for (const row of rows) {
    const supermarket = migrationStr(row.supermarket_name ?? row.name ?? row.store)
    const storeCode = row.store_code
    const barcode = migrationStr(row.barcode)
    let productName = migrationStr(row.product_name ?? row.product)
    const qty = Number(row.quantity ?? row.qty)
    const dateRaw = row.delivery_date

    if (!supermarket || !productName || !barcode || !Number.isFinite(qty) || qty <= 0) {
      dropped++
      continue
    }

    const isoDate = toSqlDate(migrationStr(dateRaw))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      dropped++
      continue
    }
    if (migrationStr(dateRaw) !== isoDate) dateFixed++

    const catalogName = catalogByBarcode.get(barcode)
    if (catalogName && productName.toLowerCase() !== catalogName.toLowerCase()) {
      productName = catalogName
      nameFixed++
    }

    fixedRows.push({
      supermarket_name: supermarket,
      product_name: productName,
      quantity: qty,
      delivery_date: isoDate,
      branch: 'SPINTEX',
      store_code: storeCode ?? '',
      barcode,
    })
  }

  return { fixedRows, dropped, dateFixed, nameFixed }
}

async function loadProductionCatalog(barcodes: string[]) {
  if (!process.env.DATABASE_URL) return new Map<string, string>()
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    return loadCatalogByBarcode(pool, barcodes)
  } finally {
    await pool.end()
  }
}

async function main() {
  const buffer = readFileSync(INPUT)
  const { columns, rows } = await parseWorkbook(buffer)

  let returnRows: Record<string, unknown>[] = []
  try {
    returnRows = (await parseWorkbook(readFileSync(RETURNS_INPUT))).rows
  } catch {
    console.warn('Returns FIXED file not found — skipping gap rows:', RETURNS_INPUT)
  }

  const existingBarcodes = new Set(rows.map((r) => migrationStr(r.barcode)))
  const allBarcodes = [
    ...new Set([
      ...rows.map((r) => migrationStr(r.barcode)),
      ...returnRows.map((r) => migrationStr(r.barcode)),
    ]),
  ].filter(Boolean)

  const catalogByBarcode = await loadProductionCatalog(allBarcodes)
  const { fixedRows, dropped, dateFixed, nameFixed } = await fixDeliveriesRows(rows, catalogByBarcode)

  const gapRows = buildDeliveryRowsFromReturnsGaps(returnRows, catalogByBarcode).filter(
    (g) => !existingBarcodes.has(migrationStr(g.barcode))
  )

  const mergedRows = [
    ...fixedRows,
    ...gapRows.map(({ _gap_source, ...row }) => ({ ...row, _gap_source })),
  ]

  const { highlightedByKind } = await writeFixedMigrationWorkbook({
    outputPath: OUTPUT,
    dataColumns: DATA_COLS,
    dateColumns: ['delivery_date'],
    rows: mergedRows.map(({ _gap_source, ...row }) => row),
    legend: LEGEND,
    getHighlight: (_row, index) => {
      const src = mergedRows[index]
      if (isGapSupplementRow(src)) {
        return {
          kind: 'rose',
          reviewFlag: buildReviewFlag(
            'NEW FROM RETURNS',
            migrationStr(src._gap_source)
          ),
        }
      }
      return null
    },
    columnWidths: { product_name: 42, barcode: 16 },
  })

  const reparsed = await parseWorkbook(readFileSync(OUTPUT))
  let validateErrors = 0
  for (const row of reparsed.rows) {
    const { errors } = validateRow('deliveries', row)
    if (errors.length) validateErrors++
  }

  printFixSummary({
    title: 'DELIVERIES FIX SUMMARY',
    inputPath: INPUT,
    outputPath: OUTPUT,
    inputRows: rows.length,
    outputRows: mergedRows.length,
    highlightedByKind,
    extra: {
      Dropped: dropped,
      'Gap rows from returns': gapRows.length,
      'Dates normalized': dateFixed,
      'Names aligned to catalog': nameFixed,
      'Branch set to SPINTEX on all rows': 'yes',
      'Input columns': columns.join(', '),
      'Detected entity': detectEntityType('deliveries.xlsx', reparsed.columns) ?? '',
      'validateRow errors': validateErrors,
    },
  })
}

import { pathToFileURL } from 'node:url'

const isMain =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
