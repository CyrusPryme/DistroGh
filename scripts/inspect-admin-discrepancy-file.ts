/**
 * Inspect admin discrepancy fix workbook structure and row counts.
 * Usage: npx tsx scripts/inspect-admin-discrepancy-file.ts [path]
 */
import ExcelJS from 'exceljs'
import { resolve } from 'node:path'

const DEFAULT = resolve(process.cwd(), 'discrepancies fix/chronology fix admin.xlsx')

function cellVal(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return String((v as { result?: unknown }).result ?? '')
  }
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text?: string }).text ?? '')
  }
  return String(v).trim()
}

async function main() {
  const path = process.argv[2] ?? DEFAULT
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  console.log('File:', path)
  console.log('Sheets:', wb.worksheets.map((w) => w.name).join(', '))

  for (const ws of wb.worksheets) {
    console.log(`\n=== ${ws.name} (${ws.rowCount} rows) ===`)
    const maxRow = ws.rowCount || 0
    for (let r = 1; r <= maxRow; r++) {
      const vals: string[] = []
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, col) => {
        if (col <= 30) vals[col - 1] = cellVal(c.value)
      })
      const line = vals.map((v) => v || '').join(' | ')
      if (line.trim()) console.log(`R${r}: ${line}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
