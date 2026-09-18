import ExcelJS from 'exceljs'
import { resolve } from 'node:path'
import { loadSystemCorrectRows, buildSystemCorrectPlan } from '@/lib/migration/system-correct-workbook'
import { parseWorkbook } from '@/lib/migration/parse'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const FILE = resolve(process.cwd(), 'discrepancies fix/receving and delivered corrcetion for nasmin.xlsx')

function cellVal(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE)
  console.log('Sheets:', wb.worksheets.map((s) => s.name))

  for (const ws of wb.worksheets) {
    const headers: string[] = []
    ws.getRow(1).eachCell((c, i) => {
      headers[i] = cellVal(c.value)
    })
    console.log(`\n=== ${ws.name} headers ===`, headers.filter(Boolean))
    for (let r = 2; r <= Math.min(ws.rowCount ?? 0, 25); r++) {
      const row: string[] = []
      ws.getRow(r).eachCell((c, i) => {
        row[i] = cellVal(c.value).slice(0, 60)
      })
      if (row.some(Boolean)) console.log(`R${r}`, row.filter(Boolean).join(' | '))
    }
  }

  // Try system-correct layout on sheet 1
  try {
    const rows = await loadSystemCorrectRows(FILE)
    console.log('\nSystem-correct rows:', rows.length)
    for (const r of rows) console.log(JSON.stringify(r))
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    const plan = await buildSystemCorrectPlan(pool, rows)
    await pool.end()
    console.log('\nPlanned actions:', plan.actions.length)
    for (const a of plan.actions) console.log(a.kind, a)
    if (plan.skipped.length) console.log('Skipped:', plan.skipped)
    if (plan.unresolved.length) console.log('Unresolved:', plan.unresolved)
  } catch (e) {
    console.log('\nNot system-correct layout:', (e as Error).message)
  }

  // Try migration deliveries Data sheet
  try {
    const { rows } = await parseWorkbook(readFileSync(FILE))
    console.log('\nMigration parse rows:', rows.length)
    for (const r of rows.slice(0, 30)) console.log(JSON.stringify(r))
  } catch (e) {
    console.log('Migration parse failed:', (e as Error).message)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
