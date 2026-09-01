/**
 * One-off analysis of a sales migration spreadsheet against production/local DB rules.
 * Usage: npx tsx -r dotenv/config scripts/analyze-sales-upload.ts dotenv_config_path=.env.local
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { normalizeSalesRowData } from '@/lib/migration/sales-fields'
import { validateRow } from '@/lib/migration/validate'
import { matchSupermarketByBranch } from '@/lib/supermarket-match'

const fileArg = process.argv.find((a) => /\.xlsx$/i.test(a))
const FILE = resolve(
  process.cwd(),
  fileArg ?? 'sales migration/migration-sales-FIXED.xlsx'
)

type ProductRow = { id: string; name: string; barcode: string | null; vendor_id: string }
type SmRow = { id: string; name: string; branch: string | null; store_code: string | null }

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

async function main() {
  const buffer = readFileSync(FILE)
  const { sheetNames, columns, rows } = await parseWorkbook(buffer)

  console.log('=== FILE OVERVIEW ===')
  console.log('Path:', FILE)
  console.log('Sheets:', sheetNames.join(', '))
  console.log('Columns:', columns.join(' | '))
  console.log('Data rows:', rows.length)

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment',
  })

  const { rows: products } = await pool.query<ProductRow>(
    `SELECT id, name, barcode, vendor_id FROM public.products WHERE deleted_at IS NULL`
  )
  const { rows: supermarkets } = await pool.query<SmRow>(
    `SELECT id, name, branch, store_code FROM public.supermarkets WHERE deleted_at IS NULL`
  )
  const { rows: deliveryDates } = await pool.query<{ product_id: string; d: string }>(
    `SELECT dri.product_id, MIN(dr.delivery_date) AS d
     FROM public.delivery_run_items dri
     JOIN public.delivery_runs dr ON dr.id = dri.delivery_run_id
     GROUP BY dri.product_id`
  )
  const earliestDeliveryByProduct = new Map(
    deliveryDates.map((r) => [r.product_id, new Date(r.d)])
  )

  const productByBarcode = new Map<string, string>()
  const productByName = new Map<string, string>()
  for (const p of products) {
    if (p.barcode) productByBarcode.set(p.barcode.toLowerCase(), p.id)
    productByName.set(p.name.toLowerCase(), p.id)
  }

  const errorCounts = new Map<string, number>()
  const warningCounts = new Map<string, number>()
  const unmatchedProducts = new Map<string, number>()
  const unmatchedBranches = new Map<string, number>()
  const missingDelivery = new Map<string, number>()

  let valid = 0
  let errors = 0
  let warningsOnly = 0
  let matchedProduct = 0
  let matchedSupermarket = 0
  let totalTcost = 0
  let totalQty = 0
  let paidCount = 0
  const monthCounts = new Map<string, number>()
  const sampleErrors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    const data = normalizeSalesRowData(raw)
    const { errors: rowErrors, warnings: rowWarnings, normalized } = validateRow('sales', data)

    const barcode = str(data.code || data.barcode).toLowerCase()
    const pname = str(data.description || data.product_name || data.product).toLowerCase()
    const pid = (barcode && productByBarcode.get(barcode)) || (pname && productByName.get(pname))
    if (pid) matchedProduct++
    else if (pname || barcode) {
      const key = barcode || pname
      unmatchedProducts.set(key, (unmatchedProducts.get(key) ?? 0) + 1)
    }

    const branch = str(data.store_name || data.branch)
    const storeCode = str(data.store || data.store_code)
    const sm = matchSupermarketByBranch(branch, storeCode, supermarkets)
    if (sm) matchedSupermarket++
    else if (branch || storeCode) {
      unmatchedBranches.set(branch || storeCode, (unmatchedBranches.get(branch || storeCode) ?? 0) + 1)
    }

    if (pid) {
      const period = str(normalized.week_start || normalized.report_month)
      const saleDate = period ? new Date(period) : null
      const earliest = earliestDeliveryByProduct.get(pid)
      if (saleDate && earliest && saleDate < earliest) {
        const k = `${pname || barcode} (before ${earliest.toISOString().slice(0, 10)})`
        missingDelivery.set(k, (missingDelivery.get(k) ?? 0) + 1)
      }
    }

    for (const e of rowErrors) {
      errorCounts.set(e.code, (errorCounts.get(e.code) ?? 0) + 1)
      if (sampleErrors.length < 15) {
        sampleErrors.push(`Row ${i + 2}: [${e.code}] ${e.message}`)
      }
    }
    for (const w of rowWarnings) {
      warningCounts.set(w.code, (warningCounts.get(w.code) ?? 0) + 1)
    }

    if (rowErrors.length) errors++
    else if (rowWarnings.length) warningsOnly++
    else valid++

    const tcost = Number(normalized.total_sales ?? data.TCostEx ?? 0)
    if (Number.isFinite(tcost)) totalTcost += tcost
    const qty = Number(normalized.qty ?? data.qty ?? 0)
    if (Number.isFinite(qty)) totalQty += qty
    if (normalized.supermarket_paid === true) paidCount++

    const month = str(normalized.report_month || normalized.week_start).slice(0, 7)
    if (month) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1)
  }

  console.log('\n=== ROW VALIDATION (per-row rules) ===')
  console.log('Clean (no errors/warnings):', valid)
  console.log('Warnings only:', warningsOnly)
  console.log('Has errors:', errors)

  console.log('\n=== ERROR CODES ===')
  for (const [code, count] of [...errorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}: ${count}`)
  }
  if (!errorCounts.size) console.log('  (none)')

  console.log('\n=== WARNING CODES ===')
  for (const [code, count] of [...warningCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code}: ${count}`)
  }
  if (!warningCounts.size) console.log('  (none)')

  console.log('\n=== FK MATCHING (against DB) ===')
  console.log('Products in DB:', products.length)
  console.log('Supermarkets in DB:', supermarkets.length)
  console.log('Rows with matched product:', matchedProduct, '/', rows.length)
  console.log('Rows with matched supermarket:', matchedSupermarket, '/', rows.length)

  console.log('\n=== FINANCIAL SUMMARY ===')
  console.log('Total TCostEx (DistroGH supermarket total):', totalTcost.toFixed(2), 'GHS')
  console.log('Total qty:', totalQty)
  console.log('Rows with paid=Yes:', paidCount)

  console.log('\n=== BY MONTH ===')
  for (const [m, c] of [...monthCounts.entries()].sort()) {
    console.log(`  ${m}: ${c} rows`)
  }

  if (unmatchedProducts.size) {
    console.log('\n=== UNMATCHED PRODUCTS (top 20) ===')
    for (const [k, c] of [...unmatchedProducts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${c}x  ${k}`)
    }
    console.log(`  ... ${unmatchedProducts.size} unique unmatched keys total`)
  }

  if (unmatchedBranches.size) {
    console.log('\n=== UNMATCHED BRANCHES (top 20) ===')
    for (const [k, c] of [...unmatchedBranches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${c}x  ${k}`)
    }
    console.log(`  ... ${unmatchedBranches.size} unique unmatched branches total`)
  }

  if (missingDelivery.size) {
    console.log('\n=== SALE BEFORE DELIVERY (top 15) ===')
    for (const [k, c] of [...missingDelivery.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${c}x  ${k}`)
    }
  }

  if (sampleErrors.length) {
    console.log('\n=== SAMPLE ERRORS ===')
    for (const s of sampleErrors) console.log(' ', s)
  }

  const importReady =
    errors === 0 &&
    unmatchedProducts.size === 0 &&
    unmatchedBranches.size === 0

  console.log('\n=== VERDICT ===')
  console.log(importReady ? 'READY for migration wizard import' : 'NOT READY — fixes needed before import')

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
