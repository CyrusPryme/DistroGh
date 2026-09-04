/**
 * Deep inspect returns xlsx structure.
 */
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'

const INPUT = resolve(process.cwd(), 'returned migration/returns-NEW_corrected (1).xlsx')

async function main() {
  const buffer = readFileSync(INPUT)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  for (const ws of wb.worksheets) {
    console.log(`Sheet "${ws.name}" rows=${ws.actualRowCount}`)
    const r1: unknown[] = []
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col <= 12) r1[col - 1] = cell.value
    })
    console.log('  Headers:', r1.filter((v) => v != null && v !== ''))
    if (ws.actualRowCount >= 2) {
      const r2: unknown[] = []
      ws.getRow(2).eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= 12) r2[col - 1] = cell.value
      })
      console.log('  Row 2:', r2)
    }
  }

  const parsed = await parseWorkbook(buffer)
  const dateCol = parsed.columns.indexOf('return_date') + 1
  const sheet = wb.worksheets.find((s) => s.name === 'Data') ?? wb.worksheets[0]
  const types = new Map<string, number>()
  sheet.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return
    const v = row.getCell(dateCol > 0 ? dateCol : 4).value
    const t = v instanceof Date ? 'Date' : typeof v
    types.set(t, (types.get(t) ?? 0) + 1)
  })
  console.log('return_date cell types:', [...types.entries()])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
