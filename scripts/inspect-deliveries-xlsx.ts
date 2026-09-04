/**
 * Deep inspect deliveries xlsx structure.
 */
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'

const INPUT = resolve(
  process.cwd(),
  process.argv[2] ?? 'deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx'
)

async function main() {
  const buffer = readFileSync(INPUT)
  console.log('File size:', buffer.length)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  console.log('\nWorksheets:')
  for (const ws of wb.worksheets) {
    console.log(`  "${ws.name}" state=${ws.state} rowCount=${ws.rowCount} actual=${ws.actualRowCount}`)
    const r1 = ws.getRow(1)
    const headers: string[] = []
    r1.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = String(cell.value ?? '')
    })
    console.log('    Row 1:', headers.filter(Boolean).slice(0, 10))
    if (ws.actualRowCount >= 2) {
      const r2 = ws.getRow(2)
      const sample: unknown[] = []
      r2.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= 8) sample[col - 1] = cell.value
      })
      console.log('    Row 2:', sample)
    }
  }

  const parsed = await parseWorkbook(buffer)
  console.log('\nparseWorkbook:', parsed.columns, 'rows=', parsed.rows.length)

  // Check date cell types in raw Excel
  const sheet = wb.worksheets[0]
  const dateCol = parsed.columns.indexOf('delivery_date') + 1
  const types = new Map<string, number>()
  sheet.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return
    const v = row.getCell(dateCol).value
    const t = v instanceof Date ? 'Date' : typeof v
    types.set(t, (types.get(t) ?? 0) + 1)
  })
  console.log('\nDelivery date cell types:', [...types.entries()])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
