/**
 * Resolve product name mismatches and prep fixed deliveries file metadata.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'
import { toSqlDate } from '@/lib/utils'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const INPUT = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_ MAIDEN.xlsx')

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

async function main() {
  const buffer = readFileSync(INPUT)
  const { rows } = await parseWorkbook(buffer)

  const barcodes = [...new Set(rows.map((r) => str(r.barcode)).filter(Boolean))]
  const { rows: products } = await pool.query(
    `SELECT barcode, name FROM products WHERE deleted_at IS NULL AND barcode = ANY($1::text[])`,
    [barcodes]
  )
  const byBarcode = new Map(products.map((p) => [str(p.barcode), str(p.name)]))

  const nameFixes: Array<{ barcode: string; fileName: string; catalogName: string }> = []
  for (const row of rows) {
    const bc = str(row.barcode)
    const fileName = str(row.product_name)
    const catalogName = byBarcode.get(bc)
    if (catalogName && fileName.toLowerCase() !== catalogName.toLowerCase()) {
      if (!nameFixes.some((f) => f.barcode === bc)) {
        nameFixes.push({ barcode: bc, fileName, catalogName })
      }
    }
  }

  console.log('Name mismatches (barcode resolves, name differs):', nameFixes.length)
  nameFixes.forEach((f) => console.log(`  ${f.barcode}: "${f.fileName}" -> "${f.catalogName}"`))

  const missingBarcode = barcodes.filter((b) => !byBarcode.has(b))
  console.log('Barcodes not in catalog:', missingBarcode)

  const dateFormats = new Set(rows.map((r) => str(r.delivery_date)))
  console.log('Unique raw dates:', dateFormats.size)
  console.log('ISO sample:', toSqlDate(str(rows[0].delivery_date)))

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
