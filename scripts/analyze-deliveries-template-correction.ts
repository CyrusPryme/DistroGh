/**
 * Analyze migration-deliveries-template correction file vs production (WH gap per SKU).
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const FILE = resolve(process.cwd(), 'discrepancies fix/migration-deliveries-template_ 2 correction.xlsx')

async function main() {
  const { rows } = await parseWorkbook(readFileSync(FILE))
  const dataRows = rows.filter((r) => !/palm oil 1l/i.test(String(r.product_name ?? '')))

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)

  console.log('Rows (excl Palm Oil demo):', dataRows.length)
  console.log(
    'file_qty | recv | del_all | del_sp | wh_gap | del+file | zeros_wh | safe_import | product | vendor'
  )

  let safe = 0
  let unsafe = 0
  let unresolved = 0
  const toImport: typeof dataRows = []

  for (const r of dataRows) {
    const name = String(r.product_name ?? '').trim()
    const fileQty = Number(r.quantity)
    const { rows: prods } = await pool.query<{
      id: string
      vendor_name: string
      received: number
      delivered: number
      delivered_sp: number
    }>(
      `
      SELECT p.id, v.name AS vendor_name,
        COALESCE((SELECT SUM(quantity_received)::int FROM intakes i WHERE i.deleted_at IS NULL AND i.product_id = p.id), 0) AS received,
        COALESCE((SELECT SUM(dri.quantity_delivered)::int FROM delivery_run_items dri
          JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
          WHERE dri.product_id = p.id), 0) AS delivered,
        COALESCE((SELECT SUM(dri.quantity_delivered)::int FROM delivery_run_items dri
          JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
          WHERE dri.product_id = p.id AND dr.supermarket_id = $2::uuid), 0) AS delivered_sp
      FROM products p
      JOIN vendors v ON v.id = p.vendor_id
      WHERE p.deleted_at IS NULL AND trim(p.name) = trim($1)
      LIMIT 1
      `,
      [name, spintexId]
    )

    if (!prods[0]) {
      unresolved++
      console.log(`? | ? | ? | ? | ? | ? | ? | NO_PRODUCT | ${name.slice(0, 40)} |`)
      continue
    }

    const p = prods[0]
    const whGap = p.received - p.delivered
    const zerosWh = p.delivered + fileQty === p.received
    const ok = whGap > 0 && fileQty === whGap && zerosWh
    if (ok) {
      safe++
      toImport.push(r)
    } else if (whGap <= 0 && fileQty > 0) {
      unsafe++
    } else if (fileQty !== whGap) {
      unsafe++
    }

    console.log(
      [
        fileQty,
        p.received,
        p.delivered,
        p.delivered_sp,
        whGap,
        p.delivered + fileQty,
        zerosWh,
        ok ? 'YES' : 'NO',
        name.slice(0, 36),
        p.vendor_name.slice(0, 28),
      ].join(' | ')
    )
  }

  console.log('\nSummary:', { safe, unsafe, unresolved, total: dataRows.length })
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
