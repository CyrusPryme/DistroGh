/**
 * Inspect CORRECTION OF DATES AND QUANTITIES ON INTAKES.xlsx (headers + actions).
 */
import ExcelJS from 'exceljs'
import { resolve } from 'node:path'
import pg from 'pg'
import {
  buildSystemCorrectPlan,
  loadSystemCorrectRows,
} from '@/lib/migration/system-correct-workbook'

const FILE = resolve(process.cwd(), 'discrepancies fix/CORRECTION OF DATES AND QUANTITIES ON INTAKES.xlsx')

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE)
  const ws = wb.worksheets[0]
  console.log('Sheet:', ws.name, 'rows:', ws.rowCount)
  const headers: string[] = []
  ws.getRow(1).eachCell((c, i) => {
    headers[i] = String(c.value ?? '').trim()
  })
  console.log('Headers:', headers.filter(Boolean))

  const rows = await loadSystemCorrectRows(FILE)
  console.log('\nParsed rows:', rows.length)
  for (const r of rows) {
    console.log(`R${r.rowNum}`, JSON.stringify(r, null, 0))
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const plan = await buildSystemCorrectPlan(pool, rows)
  await pool.end()

  console.log('\n=== Planned actions:', plan.actions.length, '===')
  for (const a of plan.actions) {
    console.log(JSON.stringify(a, null, 0).slice(0, 500))
  }
  if (plan.unresolved.length) console.log('\nUnresolved:', plan.unresolved)
  if (plan.skipped.length) console.log('\nSkipped (no parser match):', plan.skipped)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
