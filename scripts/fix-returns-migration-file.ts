/**
 * Fix returns migration file + highlight rows needing admin review.
 *
 * See docs/MIGRATION-FIX-WORKBOOK.md for the standard fix workflow.
 *
 * Usage: npx tsx -r dotenv/config scripts/fix-returns-migration-file.ts dotenv_config_path=.env.local
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
  loadEarliestDeliveryByBarcode,
  migrationStr,
  printFixSummary,
  writeFixedMigrationWorkbook,
  type MigrationReviewHighlight,
  type MigrationReviewLegendRow,
} from '@/lib/migration/fix-workbook'
import {
  buildEarliestDeliveryByBarcode,
  computeReturnDeliveryLagStats,
  fixReturnDateBeforeDelivery,
} from '@/lib/migration/return-date-fix'

const INPUT = resolve(process.cwd(), 'returned migration/returns-NEW_corrected (1).xlsx')
const DELIVERIES_INPUT = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx')
const OUTPUT = resolve(process.cwd(), 'returned migration/returns-MAIDEN-FIXED.xlsx')

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

const LEGEND: MigrationReviewLegendRow[] = [
  {
    colorLabel: 'Amber (yellow)',
    meaning: 'Return date is before the earliest delivery for this product',
    adminAction: 'Correct return_date or confirm the date is intentional',
  },
  {
    colorLabel: 'Rose (pink)',
    meaning: 'Product was never delivered in the maiden deliveries import',
    adminAction: 'Add a delivery row first, or confirm the return is valid without a matching delivery',
  },
]

type ReturnsReviewKind = 'DATE_BEFORE_DELIVERY' | 'NO_DELIVERY_RECORD' | 'DATE_AND_NO_DELIVERY'

function classifyReturnRow(
  row: Record<string, unknown>,
  earliestDeliveryByBarcode: Map<string, string>,
  deliveredBarcodes: Set<string>
): { kind: ReturnsReviewKind | ''; detail: string } {
  const bc = migrationStr(row.barcode)
  const ret = toSqlDate(migrationStr(row.return_date))
  const noDelivery = bc !== '' && !deliveredBarcodes.has(bc)

  const earliest = earliestDeliveryByBarcode.get(bc)
  const dateIssue = Boolean(earliest && ret < earliest)
  const dateDetail = dateIssue ? `return ${ret} is before earliest delivery ${earliest}` : ''

  if (dateIssue && noDelivery) {
    return {
      kind: 'DATE_AND_NO_DELIVERY',
      detail: `${dateDetail}; no delivery record for this product in production`,
    }
  }
  if (dateIssue) return { kind: 'DATE_BEFORE_DELIVERY', detail: dateDetail }
  if (noDelivery) {
    return {
      kind: 'NO_DELIVERY_RECORD',
      detail: 'No delivery record for this product in production (maiden deliveries import)',
    }
  }
  return { kind: '', detail: '' }
}

function highlightForKind(kind: ReturnsReviewKind, detail: string): MigrationReviewHighlight {
  if (kind === 'DATE_BEFORE_DELIVERY') {
    return { kind: 'amber', reviewFlag: buildReviewFlag('FIX DATE', detail) }
  }
  if (kind === 'NO_DELIVERY_RECORD') {
    return { kind: 'rose', reviewFlag: buildReviewFlag('NO DELIVERY', detail) }
  }
  return { kind: 'both', reviewFlag: buildReviewFlag('FIX DATE + NO DELIVERY', detail) }
}

export async function fixReturnsRows(
  rows: Record<string, unknown>[],
  catalogByBarcode: Map<string, string>,
  earliestDeliveryByBarcode: Map<string, string>,
  deliveredBarcodes: Set<string>
): Promise<{
  fixedRows: Record<string, unknown>[]
  dropped: number
  dateFixed: number
  nameFixed: number
  chronologyFixed: number
}> {
  const normalized: Array<{
    row: Record<string, unknown>
    bc: string
    productName: string
    qty: number
    isoDate: string
    dateNormalized: boolean
    nameFixed: boolean
  }> = []

  let dropped = 0
  let dateFixed = 0
  let nameFixed = 0

  for (const row of rows) {
    const bc = migrationStr(row.barcode)
    let productName = migrationStr(row.product_name ?? row.product)
    const qty = Number(row.quantity ?? row.qty)
    const dateRaw = row.return_date

    if (!bc || !productName || !Number.isFinite(qty) || qty <= 0) {
      dropped++
      continue
    }

    const isoDate = toSqlDate(migrationStr(dateRaw))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      dropped++
      continue
    }
    const dateNormalized = migrationStr(dateRaw) !== isoDate
    if (dateNormalized) dateFixed++

    const catalogName = catalogByBarcode.get(bc)
    let rowNameFixed = false
    if (catalogName && productName.toLowerCase() !== catalogName.toLowerCase()) {
      productName = catalogName
      nameFixed++
      rowNameFixed = true
    }

    normalized.push({
      row,
      bc,
      productName,
      qty,
      isoDate,
      dateNormalized,
      nameFixed: rowNameFixed,
    })
  }

  const lagStats = computeReturnDeliveryLagStats(
    normalized.map((n) => ({ barcode: n.bc, return_date: n.isoDate })),
    earliestDeliveryByBarcode
  )

  const fixedRows: Record<string, unknown>[] = []
  let chronologyFixed = 0

  for (const n of normalized) {
    const earliest = earliestDeliveryByBarcode.get(n.bc)
    let returnDate = n.isoDate
    let chronologyNote = ''

    if (earliest && returnDate < earliest) {
      const siblings = (lagStats.validReturnDatesByBarcode.get(n.bc) ?? []).filter((d) => d !== n.isoDate)
      const fix = fixReturnDateBeforeDelivery(
        returnDate,
        earliest,
        siblings,
        lagStats.medianLagDays
      )
      if (fix.adjusted) {
        returnDate = fix.returnDate
        chronologyNote = fix.detail
        chronologyFixed++
      }
    }

    const classification = classifyReturnRow(
      { ...n.row, barcode: n.bc, return_date: returnDate },
      earliestDeliveryByBarcode,
      deliveredBarcodes
    )

    const existingNotes = migrationStr(n.row.notes)
    const notes = chronologyNote
      ? [existingNotes, chronologyNote].filter(Boolean).join(' | ')
      : existingNotes

    fixedRows.push({
      product_name: n.productName,
      quantity: n.qty,
      return_date: returnDate,
      reason: migrationStr(n.row.reason) || 'expired',
      supermarket_name: migrationStr(n.row.supermarket_name) || 'PALACE',
      branch: 'SPINTEX',
      barcode: n.bc,
      notes,
      _review_kind: classification.kind,
      _review_detail: classification.detail,
    })
  }

  return { fixedRows, dropped, dateFixed, nameFixed, chronologyFixed }
}

async function loadProductionContext(barcodes: string[]) {
  let earliestDeliveryByBarcode = new Map<string, string>()
  try {
    const { rows: deliveryRows } = await parseWorkbook(readFileSync(DELIVERIES_INPUT))
    earliestDeliveryByBarcode = buildEarliestDeliveryByBarcode(deliveryRows)
  } catch {
    console.warn('Deliveries FIXED file not found — using production DB for delivery dates:', DELIVERIES_INPUT)
  }

  if (!process.env.DATABASE_URL) {
    return {
      catalogByBarcode: new Map<string, string>(),
      earliestDeliveryByBarcode,
      deliveredBarcodes: new Set(earliestDeliveryByBarcode.keys()),
    }
  }
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const [catalogByBarcode, delivery] = await Promise.all([
      loadCatalogByBarcode(pool, barcodes),
      loadEarliestDeliveryByBarcode(pool),
    ])
    if (!earliestDeliveryByBarcode.size) {
      earliestDeliveryByBarcode = delivery.byBarcode
    }
    return {
      catalogByBarcode,
      earliestDeliveryByBarcode,
      deliveredBarcodes: delivery.deliveredBarcodes,
    }
  } finally {
    await pool.end()
  }
}

async function main() {
  const buffer = readFileSync(INPUT)
  const { columns, rows } = await parseWorkbook(buffer)
  const barcodes = [...new Set(rows.map((r) => migrationStr(r.barcode)).filter(Boolean))]
  const { catalogByBarcode, earliestDeliveryByBarcode, deliveredBarcodes } =
    await loadProductionContext(barcodes)

  const { fixedRows, dropped, dateFixed, nameFixed, chronologyFixed } = await fixReturnsRows(
    rows,
    catalogByBarcode,
    earliestDeliveryByBarcode,
    deliveredBarcodes
  )

  const { highlightedByKind } = await writeFixedMigrationWorkbook({
    outputPath: OUTPUT,
    dataColumns: DATA_COLS,
    dateColumns: ['return_date'],
    rows: fixedRows.map(({ _review_kind, _review_detail, ...row }) => row),
    legend: LEGEND,
    getHighlight: (_row, index) => {
      const kind = migrationStr(fixedRows[index]._review_kind) as ReturnsReviewKind | ''
      const detail = migrationStr(fixedRows[index]._review_detail)
      if (!kind) return null
      return highlightForKind(kind, detail)
    },
    columnWidths: { product_name: 42, barcode: 16, review_flag: 72 },
  })

  const reparsed = await parseWorkbook(readFileSync(OUTPUT))
  let validateErrors = 0
  for (const row of reparsed.rows) {
    const { errors } = validateRow('returns', row)
    if (errors.length) validateErrors++
  }

  printFixSummary({
    title: 'RETURNS FIX SUMMARY',
    inputPath: INPUT,
    outputPath: OUTPUT,
    inputRows: rows.length,
    outputRows: fixedRows.length,
    highlightedByKind,
    extra: {
      Dropped: dropped,
      'Dates normalized': dateFixed,
      'Return dates auto-fixed (before delivery)': chronologyFixed,
      'Median delivery→return lag (days)': computeReturnDeliveryLagStats(
        rows.map((r) => ({ barcode: migrationStr(r.barcode), return_date: r.return_date })),
        earliestDeliveryByBarcode
      ).medianLagDays,
      'Names aligned to catalog': nameFixed,
      'Input columns': columns.join(', '),
      'Branch set to SPINTEX on all rows': 'yes',
      'Detected entity': detectEntityType('returns.xlsx', reparsed.columns) ?? '',
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
