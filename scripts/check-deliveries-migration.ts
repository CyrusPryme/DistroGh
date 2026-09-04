/**
 * Cross-check deliveries file against production DB.
 * Usage: npx tsx -r dotenv/config scripts/check-deliveries-migration.ts dotenv_config_path=.env.local
 */
import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'
import { validateRow } from '@/lib/migration/validate'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const DELIVERIES_MAIDEN_ID = '0c448e7b-f14c-4469-8e4d-48b8809f81db'
const INPUT = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_ MAIDEN.xlsx')

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

async function checkProductionErrors() {
  const counts = await pool.query(
    `SELECT jsonb_array_elements(errors)->>'code' AS code, COUNT(*)::int c
     FROM migration_staging_rows
     WHERE migration_id = $1 AND validation_status = 'error'
     GROUP BY 1 ORDER BY c DESC`,
    [DELIVERIES_MAIDEN_ID]
  )
  console.log('\n=== Production deliveries maiden error codes ===')
  console.log(counts.rows)

  const samples = await pool.query(
    `SELECT row_number, errors, raw_data->>'delivery_date' AS delivery_date, raw_data->>'product_name' AS product_name
     FROM migration_staging_rows
     WHERE migration_id = $1 AND validation_status = 'error'
     ORDER BY row_number LIMIT 5`,
    [DELIVERIES_MAIDEN_ID]
  )
  console.log('\n=== Sample error rows ===')
  for (const r of samples.rows) {
    console.log('row', r.row_number, 'date=', r.delivery_date, 'product=', r.product_name)
    console.log('  errors=', JSON.stringify(r.errors))
  }
}

async function checkProductsAndSupermarkets() {
  const buffer = readFileSync(INPUT)
  const { rows } = await parseWorkbook(buffer)

  const productNames = [...new Set(rows.map((r) => str(r.product_name).toLowerCase()).filter(Boolean))]
  const barcodes = [...new Set(rows.map((r) => str(r.barcode).toLowerCase()).filter(Boolean))]

  const { rows: prodByName } = await pool.query(
    `SELECT lower(name) AS name FROM products WHERE deleted_at IS NULL AND lower(name) = ANY($1::text[])`,
    [productNames]
  )
  const foundNames = new Set(prodByName.map((r) => r.name))
  const missingNames = productNames.filter((n) => !foundNames.has(n))

  const { rows: prodByBarcode } = await pool.query(
    `SELECT lower(barcode) AS barcode FROM products WHERE deleted_at IS NULL AND lower(barcode) = ANY($1::text[])`,
    [barcodes]
  )
  const foundBarcodes = new Set(prodByBarcode.map((r) => r.barcode))
  const missingBarcodes = barcodes.filter((b) => !foundBarcodes.has(b))

  console.log('\n=== Product catalog match ===')
  console.log('Unique product names in file:', productNames.length)
  console.log('Missing by name:', missingNames.length)
  if (missingNames.length) console.log('  ', missingNames)
  console.log('Missing barcodes:', missingBarcodes.length)
  if (missingBarcodes.length) console.log('  ', missingBarcodes)

  const { rows: smRows } = await pool.query(
    `SELECT id, name, branch, store_code FROM supermarkets WHERE deleted_at IS NULL AND lower(name) = 'palace'`
  )
  console.log('\n=== Palace supermarkets in production ===')
  console.log(smRows)

  const branch = str(rows[0]?.branch)
  const smName = str(rows[0]?.supermarket_name)
  const match = await pool.query(
    `SELECT id FROM supermarkets
     WHERE deleted_at IS NULL AND lower(name) = lower($1)
       AND lower(coalesce(branch,'')) = lower($2) LIMIT 1`,
    [smName, branch]
  )
  console.log('\nBranch match for', smName, branch, ':', match.rows[0]?.id ?? 'NO MATCH')

  let dateErrors = 0
  for (const row of rows) {
    const { errors } = validateRow('deliveries', row)
    if (errors.some((e) => e.code === 'INVALID_DATE' || e.code === 'MISSING_DATE')) dateErrors++
  }
  console.log('\n=== Local validateRow date errors ===', dateErrors)
}

async function main() {
  await checkProductionErrors()
  await checkProductsAndSupermarkets()
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
