/**
 * Accurate return vs delivery date check + branch fix preview.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { toSqlDate } from '@/lib/utils'

const INPUT = resolve(process.cwd(), 'returned migration/returns-NEW_corrected (1).xlsx')

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

async function main() {
  const { rows } = await parseWorkbook(readFileSync(INPUT))
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: deliveryDates } = await pool.query(
    `SELECT p.barcode, MIN(dr.delivery_date)::text AS earliest
     FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
     JOIN products p ON p.id = dri.product_id
     GROUP BY p.barcode`
  )
  const earliestByBarcode = new Map(deliveryDates.map((r) => [str(r.barcode), toSqlDate(r.earliest)]))

  let before = 0
  let noDelivery = 0
  let ok = 0
  const samples: string[] = []
  const noDeliveryProducts: string[] = []

  for (const row of rows) {
    const bc = str(row.barcode)
    const earliest = earliestByBarcode.get(bc)
    const ret = toSqlDate(str(row.return_date))
    if (!earliest) {
      noDelivery++
      noDeliveryProducts.push(`${str(row.product_name)} (${bc})`)
      continue
    }
    if (ret < earliest) {
      before++
      if (samples.length < 8) samples.push(`${row.product_name}: return ${ret} < delivery ${earliest}`)
    } else ok++
  }

  console.log('Return vs delivery (by barcode, ISO dates):')
  console.log('  OK (return on/after first delivery):', ok)
  console.log('  RETURN_BEFORE_DELIVERY warnings:', before)
  console.log('  No delivery record for product:', noDelivery)
  if (noDeliveryProducts.length) console.log('  Products:', [...new Set(noDeliveryProducts)])
  samples.forEach((s) => console.log(' ', s))

  const palaceSpintex = await pool.query(
    `SELECT id FROM supermarkets WHERE deleted_at IS NULL AND lower(name)='palace' AND lower(branch)='spintex'`
  )
  console.log('\nPalace SPINTEX id:', palaceSpintex.rows[0]?.id ?? 'NOT FOUND')

  const withBranch = rows.filter((r) => str(r.branch)).length
  console.log('Rows with branch set:', withBranch, '/', rows.length)

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
