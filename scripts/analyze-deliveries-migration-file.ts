/**
 * Analyze deliveries migration workbook.
 * Usage: npx tsx scripts/analyze-deliveries-migration-file.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'
import { detectEntityType } from '@/lib/migration/detect'

const INPUT = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_ MAIDEN.xlsx')

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function parseDate(v: unknown): boolean {
  const raw = str(v)
  if (!raw) return false
  const normalized = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw
  const d = new Date(normalized)
  return !Number.isNaN(d.getTime())
}

async function main() {
  const buffer = readFileSync(INPUT)
  const { sheetNames, columns, rows } = await parseWorkbook(buffer)
  console.log('Sheets:', sheetNames)
  console.log('Columns:', columns)
  console.log('Row count:', rows.length)
  console.log('Detected entity:', detectEntityType('deliveries.xlsx', columns))

  const dateIssues: string[] = []
  const missingProduct: number[] = []
  const missingQty: number[] = []
  const missingSupermarket: number[] = []
  const dateSamples = new Map<string, number>()

  rows.forEach((row, i) => {
    const rn = i + 2
    const product = str(row.product_name ?? row.product ?? row.barcode)
    const qty = Number(row.quantity ?? row.qty)
    const sm = str(row.supermarket_name ?? row.name ?? row.store)
    const branch = str(row.branch)
    const dateRaw = row.delivery_date

    if (!product) missingProduct.push(rn)
    if (!Number.isFinite(qty) || qty <= 0) missingQty.push(rn)
    if (!sm && !branch) missingSupermarket.push(rn)

    const dateStr = str(dateRaw)
    dateSamples.set(dateStr || '(blank)', (dateSamples.get(dateStr || '(blank)') ?? 0) + 1)
    if (!parseDate(dateRaw)) dateIssues.push(`row ${rn}: ${JSON.stringify(dateRaw)}`)
  })

  console.log('\n=== Date value distribution (top 15) ===')
  ;[...dateSamples.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([k, c]) => console.log(`  ${c}x ${k}`))

  console.log('\n=== Issues ===')
  console.log('Invalid/missing delivery_date:', dateIssues.length)
  if (dateIssues.length) console.log(dateIssues.slice(0, 10).join('\n'))
  console.log('Missing product:', missingProduct.length)
  console.log('Invalid qty:', missingQty.length)
  console.log('Missing supermarket_name and branch:', missingSupermarket.length)

  console.log('\n=== Sample rows (first 5) ===')
  rows.slice(0, 5).forEach((r, i) => console.log(i + 2, JSON.stringify(r)))

  console.log('\n=== Sample rows (last 3) ===')
  rows.slice(-3).forEach((r, i) => console.log(rows.length - 2 + i, JSON.stringify(r)))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
