/**
 * Highlight only sales rows whose product barcode is missing from production.
 * Usage: npx tsx -r dotenv/config scripts/highlight-missing-products.ts dotenv_config_path=.env.local
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'

const INPUT = resolve(process.cwd(), 'sales migration/migration-sales-template UPDATED.xlsx')
const OUTPUT = resolve(process.cwd(), 'sales migration/migration-sales-NEEDS-PRODUCT-CORRECTION.xlsx')

const RED_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFC7CE' },
}
const RED_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF9C0006' } }
const CLEAR_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'none' }
const DEFAULT_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF000000' } }

/** Same normalization as parse.ts / migration matching — avoids Excel numeric scientific notation. */
function normalizeBarcode(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  const s = String(v).trim()
  if (/^\d+\.?\d*e[+-]?\d+$/i.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return String(Math.trunc(n))
  }
  return s
}

function productCodeFromRow(data: Record<string, unknown>): string {
  return normalizeBarcode(data.Code ?? data.code ?? data.barcode)
}

async function main() {
  const buffer = readFileSync(INPUT)
  const parsed = await parseWorkbook(buffer)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows: products } = await pool.query<{ barcode: string | null; name: string }>(
    `SELECT barcode, name FROM public.products WHERE deleted_at IS NULL`
  )
  await pool.end()

  const knownBarcodes = new Set(
    products.filter((p) => p.barcode).map((p) => normalizeBarcode(p.barcode).toLowerCase())
  )
  const knownNames = new Set(products.map((p) => p.name.toLowerCase()))

  // Excel row numbers (1-based) to highlight — derived from parseWorkbook, same path as analysis.
  const highlightRowNumbers = new Set<number>()
  const missingCodes = new Set<string>()

  parsed.rows.forEach((row, index) => {
    const code = productCodeFromRow(row)
    if (!code) return
    const matched =
      knownBarcodes.has(code.toLowerCase()) || knownNames.has(code.toLowerCase())
    if (!matched) {
      missingCodes.add(code)
      highlightRowNumbers.add(index + 2) // row 1 = header; first data row = 2
    }
  })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  let dataSheet = wb.worksheets.find((s) => s.name.trim().toLowerCase() === 'data')
  if (!dataSheet) {
    dataSheet = wb.worksheets
      .filter(
        (s) => s.state !== 'hidden' && !/^(instructions|overview|_lists)$/i.test(s.name.trim())
      )
      .at(-1)
  }
  if (!dataSheet) throw new Error('Could not find Data sheet')

  const headerRow = dataSheet.getRow(1)
  const colCount = Math.max(headerRow.cellCount, dataSheet.columnCount)

  let highlighted = 0
  let cleared = 0

  dataSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return

    const shouldHighlight = highlightRowNumbers.has(rowNumber)

    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c)
      if (shouldHighlight) {
        cell.fill = RED_FILL
        cell.font = { ...(cell.font ?? {}), ...RED_FONT }
      } else {
        cell.fill = CLEAR_FILL
        cell.font = { ...(cell.font ?? {}), ...DEFAULT_FONT }
      }
    }

    if (shouldHighlight) highlighted++
    else cleared++
  })

  const instructions = wb.worksheets.find((s) => /^instructions$/i.test(s.name.trim()))
  if (instructions) {
    const noteRow = instructions.rowCount + 2
    instructions.getCell(`A${noteRow}`).value =
      'Rows highlighted in RED on the Data sheet (114 rows): product Code/barcode not found in DistroGH — add products or correct codes before migration.'
    instructions.getCell(`A${noteRow}`).font = { bold: true, color: { argb: 'FF9C0006' } }
  }

  await wb.xlsx.writeFile(OUTPUT)

  console.log('Input:', INPUT)
  console.log('Output:', OUTPUT)
  console.log('Missing product codes:', missingCodes.size)
  console.log('Rows highlighted red:', highlighted)
  console.log('Rows left unhighlighted:', cleared)
  if (highlighted !== highlightRowNumbers.size) {
    console.warn(
      `Warning: expected ${highlightRowNumbers.size} highlighted rows, applied ${highlighted}`
    )
  }
  console.log('Codes:', [...missingCodes].sort().join(', '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
