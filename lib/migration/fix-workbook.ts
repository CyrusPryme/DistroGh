/**
 * Shared utilities for historical migration workbook fixes.
 *
 * Standard output shape:
 *  - "Data" sheet with normalized rows + optional review_flag column
 *  - "Review legend" sheet explaining highlight colors
 *  - Row fills: amber (date/chronology), rose (missing prerequisite), both, red (hard blocker)
 *
 * See docs/MIGRATION-FIX-WORKBOOK.md for the full workflow.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import ExcelJS from 'exceljs'
import type { Pool } from 'pg'
import { toSqlDate } from '@/lib/utils'

export const REVIEW_FLAG_COLUMN = 'review_flag'

export const MIGRATION_REVIEW_FILLS = {
  header: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  },
  amber: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF3CD' },
  },
  rose: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFCE7F3' },
  },
  both: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFE4E6' },
  },
  red: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFEE2E2' },
  },
} as const satisfies Record<string, ExcelJS.Fill>

export type MigrationReviewHighlightKind = keyof Pick<
  typeof MIGRATION_REVIEW_FILLS,
  'amber' | 'rose' | 'both' | 'red'
>

export interface MigrationReviewHighlight {
  kind: MigrationReviewHighlightKind
  /** Plain-English text for review_flag (prefix included, e.g. "FIX DATE — ...") */
  reviewFlag: string
}

export interface MigrationReviewLegendRow {
  colorLabel: string
  meaning: string
  adminAction: string
}

export interface WriteFixedMigrationWorkbookParams {
  outputPath: string
  /** Migration template columns — review_flag is appended automatically when any row is flagged */
  dataColumns: readonly string[]
  rows: Record<string, unknown>[]
  /** Column names rendered as Excel date cells (ISO YYYY-MM-DD strings in row data) */
  dateColumns?: readonly string[]
  legend: MigrationReviewLegendRow[]
  getHighlight?: (row: Record<string, unknown>, index: number) => MigrationReviewHighlight | null
  columnWidths?: Partial<Record<string, number>>
  /** Include review_flag column even when no rows flagged (default: only when flagged) */
  alwaysIncludeReviewFlag?: boolean
}

export function migrationStr(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

export function isoToExcelDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function fillForHighlightKind(kind: MigrationReviewHighlightKind): ExcelJS.Fill {
  return MIGRATION_REVIEW_FILLS[kind]
}

/** Build review_flag text with a consistent prefix per issue class. */
export function buildReviewFlag(prefix: string, detail: string): string {
  return detail ? `${prefix} — ${detail}` : prefix
}

export async function loadCatalogByBarcode(
  pool: Pool,
  barcodes: string[]
): Promise<Map<string, string>> {
  if (!barcodes.length) return new Map()
  const { rows } = await pool.query(
    `SELECT barcode, name FROM products WHERE deleted_at IS NULL AND barcode = ANY($1::text[])`,
    [barcodes]
  )
  return new Map(rows.map((p) => [migrationStr(p.barcode), migrationStr(p.name)]))
}

export async function loadEarliestDeliveryByBarcode(
  pool: Pool
): Promise<{ byBarcode: Map<string, string>; deliveredBarcodes: Set<string> }> {
  const { rows } = await pool.query(
    `SELECT p.barcode, MIN(dr.delivery_date)::text AS earliest
     FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
     JOIN products p ON p.id = dri.product_id
     GROUP BY p.barcode`
  )
  const byBarcode = new Map(rows.map((r) => [migrationStr(r.barcode), toSqlDate(r.earliest)]))
  const deliveredBarcodes = new Set(rows.map((r) => migrationStr(r.barcode)))
  return { byBarcode, deliveredBarcodes }
}

export async function writeFixedMigrationWorkbook(
  params: WriteFixedMigrationWorkbookParams
): Promise<{ highlightedByKind: Record<MigrationReviewHighlightKind, number[]>; outputColumns: string[] }> {
  const {
    outputPath,
    dataColumns,
    rows,
    dateColumns = [],
    legend,
    getHighlight,
    columnWidths = {},
    alwaysIncludeReviewFlag = false,
  } = params

  const highlights = rows.map((row, i) => getHighlight?.(row, i) ?? null)
  const anyFlagged = highlights.some(Boolean)
  const outputColumns = [
    ...dataColumns,
    ...(anyFlagged || alwaysIncludeReviewFlag ? [REVIEW_FLAG_COLUMN] : []),
  ]

  const highlightedByKind: Record<MigrationReviewHighlightKind, number[]> = {
    amber: [],
    rose: [],
    both: [],
    red: [],
  }

  mkdirSync(dirname(outputPath), { recursive: true })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')

  const legendSheet = wb.addWorksheet('Review legend')
  legendSheet.addRow(['Color', 'Meaning', 'Admin action'])
  for (const row of legend) {
    legendSheet.addRow([row.colorLabel, row.meaning, row.adminAction])
  }
  legendSheet.getRow(1).font = { bold: true }
  legendSheet.getColumn(1).width = 18
  legendSheet.getColumn(2).width = 55
  legendSheet.getColumn(3).width = 50

  ws.addRow([...outputColumns])
  const headerRow = ws.getRow(1)
  headerRow.font = { bold: true }
  headerRow.eachCell((cell) => {
    cell.fill = MIGRATION_REVIEW_FILLS.header
  })

  const dateColSet = new Set(dateColumns)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const highlight = highlights[i]
    const excelRowNum = i + 2

    const outRow: Record<string, unknown> = { ...row }
    if (outputColumns.includes(REVIEW_FLAG_COLUMN)) {
      outRow[REVIEW_FLAG_COLUMN] = highlight?.reviewFlag ?? ''
    }

    ws.addRow(
      outputColumns.map((col) => {
        const v = outRow[col]
        if (dateColSet.has(col) && migrationStr(v)) return isoToExcelDate(migrationStr(v))
        return v ?? ''
      })
    )

    if (highlight) {
      highlightedByKind[highlight.kind].push(excelRowNum)
      const fill = fillForHighlightKind(highlight.kind)
      ws.getRow(excelRowNum).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = fill
      })
    }
  }

  for (const col of dateColumns) {
    const idx = outputColumns.indexOf(col) + 1
    if (idx > 0) ws.getColumn(idx).numFmt = 'yyyy-mm-dd'
  }
  for (const [col, width] of Object.entries(columnWidths)) {
    const idx = outputColumns.indexOf(col) + 1
    if (idx > 0) ws.getColumn(idx).width = width
  }
  if (outputColumns.includes(REVIEW_FLAG_COLUMN)) {
    ws.getColumn(outputColumns.indexOf(REVIEW_FLAG_COLUMN) + 1).width = columnWidths[REVIEW_FLAG_COLUMN] ?? 72
  }

  await wb.xlsx.writeFile(outputPath)

  return { highlightedByKind, outputColumns }
}

export function printFixSummary(params: {
  title: string
  inputPath: string
  outputPath: string
  inputRows: number
  outputRows: number
  highlightedByKind: Record<MigrationReviewHighlightKind, number[]>
  extra?: Record<string, string | number>
}): void {
  console.log(`=== ${params.title} ===`)
  console.log('Input:', params.inputPath)
  console.log('Output:', params.outputPath)
  console.log('Input rows:', params.inputRows)
  console.log('Output rows:', params.outputRows)
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) console.log(`${k}:`, v)
  }
  console.log('\n=== HIGHLIGHTED FOR ADMIN ===')
  const labels: Record<MigrationReviewHighlightKind, string> = {
    amber: 'Amber (date/chronology)',
    rose: 'Rose (missing prerequisite)',
    both: 'Both issues',
    red: 'Red (hard blocker)',
  }
  for (const kind of ['amber', 'rose', 'both', 'red'] as const) {
    const rows = params.highlightedByKind[kind]
    if (rows.length) console.log(`${labels[kind]}: ${rows.length} → Excel rows ${rows.join(', ')}`)
  }
  if (!Object.values(params.highlightedByKind).some((r) => r.length)) {
    console.log('No rows flagged for admin review.')
  }
  console.log('\nReview legend sheet included. Remove review_flag column before final upload.')
}
