/**
 * Analyze returns migration workbook for migration readiness.
 * Usage: npx tsx -r dotenv/config scripts/analyze-returns-migration-file.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { detectEntityType } from '@/lib/migration/detect'
import { validateRow } from '@/lib/migration/validate'
import { toSqlDate } from '@/lib/utils'

const INPUT = resolve(process.cwd(), 'returned migration/returns-NEW_corrected (1).xlsx')

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function parseDateOk(v: unknown): boolean {
  const raw = str(v)
  if (!raw) return false
  const normalized = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw
  return !Number.isNaN(new Date(normalized).getTime())
}

async function main() {
  const buffer = readFileSync(INPUT)
  const { sheetNames, columns, rows } = await parseWorkbook(buffer)

  console.log('=== FILE OVERVIEW ===')
  console.log('File:', INPUT)
  console.log('Size bytes:', buffer.length)
  console.log('Sheets:', sheetNames)
  console.log('Columns:', columns)
  console.log('Row count:', rows.length)
  console.log('Detected entity:', detectEntityType('returns.xlsx', columns))

  const dateSamples = new Map<string, number>()
  const reasonSamples = new Map<string, number>()
  let dateErrors = 0
  let qtyErrors = 0
  let missingProduct = 0
  let missingReason = 0
  let validateErrors = 0
  let validateWarnings = 0
  const errorCodes = new Map<string, number>()

  for (const row of rows) {
    const dateStr = str(row.return_date)
    dateSamples.set(dateStr || '(blank)', (dateSamples.get(dateStr || '(blank)') ?? 0) + 1)
    const reason = str(row.reason)
    reasonSamples.set(reason || '(blank)', (reasonSamples.get(reason || '(blank)') ?? 0) + 1)

    if (!parseDateOk(row.return_date)) dateErrors++
    const qty = Number(row.quantity ?? row.qty)
    if (!Number.isFinite(qty) || qty <= 0) qtyErrors++
    if (!str(row.product_name) && !str(row.product) && !str(row.barcode)) missingProduct++
    if (!reason) missingReason++

    const { errors, warnings } = validateRow('returns', row)
    if (errors.length) validateErrors++
    if (warnings.length) validateWarnings++
    for (const e of errors) errorCodes.set(e.code, (errorCodes.get(e.code) ?? 0) + 1)
    for (const w of warnings) errorCodes.set(w.code, (errorCodes.get(w.code) ?? 0) + 1)
  }

  console.log('\n=== LOCAL validateRow (no DB FK) ===')
  console.log('Rows with errors:', validateErrors)
  console.log('Rows with warnings:', validateWarnings)
  if (errorCodes.size) {
    console.log('Issue codes:')
    ;[...errorCodes.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`  ${c}x ${k}`))
  }
  console.log('Invalid dates:', dateErrors)
  console.log('Invalid qty:', qtyErrors)
  console.log('Missing product:', missingProduct)
  console.log('Missing reason (warning only):', missingReason)

  console.log('\n=== Date distribution (top 15) ===')
  ;[...dateSamples.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([k, c]) => console.log(`  ${c}x ${k}`))

  console.log('\n=== Reason distribution (top 15) ===')
  ;[...reasonSamples.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([k, c]) => console.log(`  ${c}x ${k}`))

  console.log('\n=== Sample rows (first 3) ===')
  rows.slice(0, 3).forEach((r, i) => console.log(i + 2, JSON.stringify(r)))

  if (!process.env.DATABASE_URL) {
    console.log('\n(DATABASE_URL not set — skipping production cross-check)')
    return
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const barcodes = [...new Set(rows.map((r) => str(r.barcode)).filter(Boolean))]
  const productNames = [...new Set(rows.map((r) => str(r.product_name).toLowerCase()).filter(Boolean))]

  const { rows: prodByBarcode } = await pool.query(
    `SELECT barcode, name FROM products WHERE deleted_at IS NULL AND barcode = ANY($1::text[])`,
    [barcodes.length ? barcodes : ['']]
  )
  const byBarcode = new Map(prodByBarcode.map((p) => [str(p.barcode), str(p.name)]))
  const missingBarcodes = barcodes.filter((b) => !byBarcode.has(b))

  const { rows: prodByName } = await pool.query(
    `SELECT lower(name) AS name FROM products WHERE deleted_at IS NULL AND lower(name) = ANY($1::text[])`,
    [productNames.length ? productNames : ['']]
  )
  const foundNames = new Set(prodByName.map((r) => r.name))
  const missingNames = productNames.filter((n) => !foundNames.has(n))

  console.log('\n=== PRODUCTION CATALOG ===')
  console.log('Unique barcodes in file:', barcodes.length)
  console.log('Missing barcodes:', missingBarcodes.length)
  if (missingBarcodes.length) console.log(' ', missingBarcodes.slice(0, 20))
  console.log('Unique product names:', productNames.length)
  console.log('Missing by name:', missingNames.length)
  if (missingNames.length) console.log(' ', missingNames.slice(0, 20))

  const nameFixes: string[] = []
  for (const row of rows) {
    const bc = str(row.barcode)
    const fileName = str(row.product_name)
    const catalogName = byBarcode.get(bc)
    if (catalogName && fileName.toLowerCase() !== catalogName.toLowerCase()) {
      if (!nameFixes.includes(`${bc}: "${fileName}" -> "${catalogName}"`)) {
        nameFixes.push(`${bc}: "${fileName}" -> "${catalogName}"`)
      }
    }
  }
  if (nameFixes.length) {
    console.log('\nName mismatches (barcode resolves):', nameFixes.length)
    nameFixes.slice(0, 15).forEach((f) => console.log(' ', f))
  }

  const { rows: smRows } = await pool.query(
    `SELECT id, name, branch, store_code FROM supermarkets WHERE deleted_at IS NULL ORDER BY name, branch`
  )
  const smKeys = new Set(smRows.map((s) => `${str(s.name).toLowerCase()}::${str(s.branch).toLowerCase()}`))

  let smMatch = 0
  let smMissing = 0
  const smMissingSamples: string[] = []
  for (const row of rows) {
    const sm = str(row.supermarket_name ?? row.name ?? row.store).toLowerCase()
    const branch = str(row.branch).toLowerCase()
    if (!sm && !branch) continue
    const key = `${sm}::${branch}`
    if (smKeys.has(key)) smMatch++
    else {
      smMissing++
      if (smMissingSamples.length < 8) smMissingSamples.push(`${row.supermarket_name}/${row.branch}`)
    }
  }
  console.log('\n=== SUPERMARKET MATCH ===')
  console.log('Rows with supermarket+branch:', smMatch + smMissing)
  console.log('Matched:', smMatch)
  console.log('Unmatched:', smMissing)
  if (smMissingSamples.length) console.log('Samples:', smMissingSamples)

  const { rows: deliveryDates } = await pool.query(
    `SELECT dri.product_id, p.barcode, MIN(dr.delivery_date) AS earliest_delivery
     FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
     JOIN products p ON p.id = dri.product_id
     GROUP BY dri.product_id, p.barcode`
  )
  const earliestDeliveryByBarcode = new Map(
    deliveryDates.map((r) => [str(r.barcode), String(r.earliest_delivery).slice(0, 10)])
  )

  let beforeDelivery = 0
  const beforeSamples: string[] = []
  for (const row of rows) {
    const bc = str(row.barcode)
    const earliest = earliestDeliveryByBarcode.get(bc)
    if (!earliest) continue
    const returnDate = toSqlDate(str(row.return_date))
    if (returnDate < earliest) {
      beforeDelivery++
      if (beforeSamples.length < 5) {
        beforeSamples.push(`${str(row.product_name)} return ${returnDate} before delivery ${earliest}`)
      }
    }
  }
  console.log('\n=== RETURN BEFORE DELIVERY (warning if validated) ===')
  console.log('Rows:', beforeDelivery)
  beforeSamples.forEach((s) => console.log(' ', s))

  const returnsProjects = await pool.query(
    `SELECT id, name, status FROM migration_projects WHERE lower(name) LIKE '%return%maiden%' ORDER BY created_at DESC LIMIT 3`
  )
  console.log('\n=== EXISTING RETURNS MIGRATION PROJECTS ===')
  console.log(returnsProjects.rows)

  await pool.end()

  console.log('\n=== READINESS SUMMARY ===')
  const blockers: string[] = []
  if (rows.length === 0) blockers.push('File parses to 0 rows')
  if (detectEntityType('returns.xlsx', columns) !== 'returns') blockers.push('Entity type not detected as returns')
  if (dateErrors > 0) blockers.push(`${dateErrors} rows with unparseable return_date`)
  if (qtyErrors > 0) blockers.push(`${qtyErrors} rows with invalid quantity`)
  if (missingProduct > 0) blockers.push(`${missingProduct} rows missing product identifier`)
  if (missingBarcodes.length > 0) blockers.push(`${missingBarcodes.length} barcodes not in production catalog`)

  if (blockers.length) {
    console.log('NOT READY — blockers:')
    blockers.forEach((b) => console.log('  -', b))
  } else {
    console.log('READY for upload after any date/header normalization (like deliveries fix)')
    if (missingNames.length) console.log(`Note: ${missingNames.length} name mismatches OK if barcode resolves`)
    if (beforeDelivery > 0) console.log(`Note: ${beforeDelivery} rows may get RETURN_BEFORE_DELIVERY warnings`)
    if (missingReason > 0) console.log(`Note: ${missingReason} rows missing reason → default "other" warning`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
