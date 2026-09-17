/**
 * List NASMIN Aunty Lulu delivery runs/items for reconciliation audit.
 */
import 'dotenv/config'
import pg from 'pg'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows } = await pool.query<{
    product_name: string
    delivery_date: string
    qty: number
    run_id: string
    notes: string | null
    source: string | null
  }>(
    `
    SELECT p.name AS product_name, dr.delivery_date::text, dri.quantity_delivered AS qty,
           dr.id AS run_id, dr.notes, dr.source
    FROM delivery_run_items dri
    JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
    JOIN products p ON p.id = dri.product_id
    JOIN vendors v ON v.id = p.vendor_id
    WHERE p.deleted_at IS NULL AND lower(v.name) LIKE '%nasmin%' AND p.name LIKE 'AUNTY LULU%'
    ORDER BY p.name, dr.delivery_date, dr.created_at
    `
  )
  let cur = ''
  let sum = 0
  for (const r of rows) {
    if (r.product_name !== cur) {
      if (cur) console.log(`  -- total ${sum}`)
      cur = r.product_name
      sum = 0
      console.log('\n' + cur)
    }
    sum += r.qty
    console.log(`  ${r.delivery_date} qty=${r.qty} source=${r.source ?? ''} ${(r.notes ?? '').slice(0, 60)} run=${r.run_id}`)
  }
  if (cur) console.log(`  -- total ${sum}`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
