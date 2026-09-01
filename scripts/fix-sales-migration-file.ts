/**
 * Fix Palace sales upload: DD-MM-YYYY dates → YYYY-MM-01, store_name ← BRANCH.
 * Usage: npx tsx scripts/fix-sales-migration-file.ts
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import ExcelJS from 'exceljs'
import { parseWorkbook } from '@/lib/migration/parse'

const INPUT = resolve(process.cwd(), 'sales migration/migration-sales-template UPDATED.xlsx')
const OUTPUT = resolve(process.cwd(), 'sales migration/migration-sales-FIXED.xlsx')

export function ddMmYyyyToReportMonth(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12 || year < 1900 || year > 2100 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-01`
}

async function main() {
  const buffer = readFileSync(INPUT)
  const { sheetNames, columns, rows } = await parseWorkbook(buffer)

  const fixedRows: Record<string, unknown>[] = []
  let dateFixed = 0
  let branchFixed = 0
  let dropped = 0

  for (const row of rows) {
    const branch = String(row.BRANCH ?? row.branch ?? '').trim()
    const storeName = String(row.store_name ?? '').trim()
    const reportMonthRaw = row.report_month
    const reportMonth = ddMmYyyyToReportMonth(reportMonthRaw)

    const code = row.Code ?? row.code
    const qty = Number(row.Qty ?? row.qty)
    const tcost = Number(row.TCostEx ?? row.tcostex)

    if (!code || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(tcost)) {
      dropped++
      continue
    }
    if (!reportMonth) {
      dropped++
      continue
    }

    const outlet = branch || (storeName.toUpperCase() === 'PALACE MALL' ? '' : storeName)
    if (!outlet) {
      dropped++
      continue
    }

    if (reportMonthRaw !== reportMonth) dateFixed++
    if (storeName.toUpperCase() === 'PALACE MALL' && branch) branchFixed++

    fixedRows.push({
      description: String(code),
      code: String(code),
      qty,
      store_name: outlet,
      branch: outlet,
      TCostEx: tcost,
      report_month: reportMonth,
      paid: row.paid ?? row.PAID ?? '',
    })
  }

  mkdirSync(dirname(OUTPUT), { recursive: true })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')
  const outCols = ['description', 'code', 'qty', 'store_name', 'TCostEx', 'report_month', 'paid'] as const
  ws.addRow([...outCols])
  for (const r of fixedRows) {
    ws.addRow(outCols.map((c) => r[c] ?? ''))
  }
  await wb.xlsx.writeFile(OUTPUT)

  console.log('=== FIX SUMMARY ===')
  console.log('Input rows:', rows.length)
  console.log('Output rows:', fixedRows.length)
  console.log('Dropped (bad/missing data):', dropped)
  console.log('Dates converted (DD-MM-YYYY → YYYY-MM-01):', dateFixed)
  console.log('store_name set from BRANCH:', branchFixed)
  console.log('Written:', OUTPUT)
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
