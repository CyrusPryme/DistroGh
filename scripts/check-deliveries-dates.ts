/**
 * Check delivery vs intake dates for warnings.
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
    `SELECT id, barcode, name FROM products WHERE deleted_at IS NULL AND barcode = ANY($1::text[])`,
    [barcodes]
  )
  const byBarcode = new Map(products.map((p) => [str(p.barcode), p]))

  const { rows: intakes } = await pool.query(
    `SELECT product_id, MIN(received_date) AS d FROM intakes GROUP BY product_id`
  )
  const earliestIntake = new Map(intakes.map((r) => [r.product_id, r.d]))

  let beforeIntake = 0
  const samples: string[] = []
  for (const row of rows) {
    const p = byBarcode.get(str(row.barcode))
    if (!p) continue
    const intake = earliestIntake.get(p.id)
    if (!intake) continue
    const d = toSqlDate(str(row.delivery_date))
    if (d < intake) {
      beforeIntake++
      if (samples.length < 5) {
        samples.push(`${p.name}: delivery ${d} before intake ${intake}`)
      }
    }
  }

  console.log('Rows with delivery before earliest intake:', beforeIntake)
  samples.forEach((s) => console.log(' ', s))

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
