/**
 * Compare migration-deliveries-template_LULU SHITO.xlsx targets vs production delivery totals.
 * Usage: npx tsx -r dotenv/config scripts/compare-lulu-delivery-targets.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'

const TEMPLATE = resolve(process.cwd(), 'discrepancies fix/migration-deliveries-template_LULU SHITO.xlsx')

async function main() {
  const { rows } = await parseWorkbook(readFileSync(TEMPLATE))
  const targets = new Map<string, { qty: number; date: string }>()
  for (const r of rows) {
    const name = String(r.product_name ?? '')
    if (!/LULU/i.test(name)) continue
    targets.set(name, { qty: Number(r.quantity), date: String(r.delivery_date ?? '') })
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows: vendors } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM vendors WHERE deleted_at IS NULL AND lower(name) LIKE '%nasmin%' LIMIT 1`
  )
  if (!vendors[0]) throw new Error('NASMIN vendor not found')
  const vid = vendors[0].id

  const { rows: prods } = await pool.query<{ name: string; received: number; delivered: number }>(
    `
    SELECT p.name,
      COALESCE((SELECT SUM(quantity_received)::int FROM intakes i WHERE i.deleted_at IS NULL AND i.product_id = p.id), 0) AS received,
      COALESCE((
        SELECT SUM(dri.quantity_delivered)::int
        FROM delivery_run_items dri
        JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
        WHERE dri.product_id = p.id
      ), 0) AS delivered
    FROM products p
    WHERE p.deleted_at IS NULL AND p.vendor_id = $1
    ORDER BY p.name
    `,
    [vid]
  )

  console.log('Vendor:', vendors[0].name)
  console.log('\nFile targets vs DB (positive delta_to_target = need more delivered):\n')
  let sumTarget = 0
  let sumCurrent = 0
  let sumDelta = 0
  for (const [name, t] of targets) {
    const cur = prods.find((p) => p.name === name)
    const delivered = cur?.delivered ?? 0
    const received = cur?.received ?? 0
    const delta = t.qty - delivered
    sumTarget += t.qty
    sumCurrent += delivered
    sumDelta += delta
    const delPlusFile = delivered + t.qty
    console.log(
      [
        name.slice(0, 36),
        `file=${t.qty}`,
        `db_del=${delivered}`,
        `recv=${received}`,
        `wh=${Math.max(0, received - delivered)}`,
        `delta_to_target=${delta}`,
        `del+file=${delPlusFile}`,
        `zeros_wh_if_add=${delPlusFile === received}`,
        `date=${t.date}`,
      ].join(' | ')
    )
  }
  console.log('\nSums (6 SKUs in file):', { file_target: sumTarget, db_delivered: sumCurrent, delta_to_target: sumDelta })

  const allRecv = prods.reduce((s, p) => s + p.received, 0)
  const allDel = prods.reduce((s, p) => s + p.delivered, 0)
  console.log('\nAll NASMIN products:', { received: allRecv, delivered: allDel, wh_on_hand: allRecv - allDel })
  console.log(
    '\nNote: for this NASMIN file, quantities match remaining WH per SKU (db_del + file_qty = received).',
    'Historical migration adds new delivery runs; it does not replace existing totals.'
  )

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
