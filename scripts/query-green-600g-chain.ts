import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const sp = await resolvePalaceSpintexId(pool)
  const { rows: p } = await pool.query<{ id: string }>(
    `SELECT id FROM products WHERE name = 'AUNTY LULUS GREEN CHILLI 600G' AND deleted_at IS NULL`
  )
  const pid = p[0]?.id
  if (!pid || !sp) throw new Error('product or spintex missing')

  const intakes = await pool.query(
    `SELECT id, received_date::text, quantity_received FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid ORDER BY received_date`,
    [pid]
  )
  const dels = await pool.query(
    `SELECT dr.id, dr.delivery_date::text, dri.id AS item_id, dri.quantity_delivered, dr.notes
     FROM delivery_run_items dri
     JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
     WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid
     ORDER BY dr.delivery_date`,
    [pid, sp]
  )
  const inv = await pool.query<{ quantity: number }>(
    `SELECT quantity FROM supermarket_inventory WHERE product_id = $1::uuid AND supermarket_id = $2::uuid`,
    [pid, sp]
  )
  const sold = await pool.query<{ q: number }>(
    `SELECT COALESCE(SUM(qty_sold), 0)::int AS q FROM sales WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid`,
    [pid, sp]
  )
  const ret = await pool.query<{ q: number }>(
    `SELECT COALESCE(SUM(quantity_returned), 0)::int AS q FROM product_returns WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid`,
    [pid, sp]
  )

  const recv = intakes.rows.reduce((s, r) => s + Number(r.quantity_received), 0)
  const del = dels.rows.reduce((s, r) => s + Number(r.quantity_delivered), 0)

  console.log({ recv, del, wh: recv - del, shelf: inv.rows[0]?.quantity ?? 0, soldSp: sold.rows[0].q, retSp: ret.rows[0].q })
  console.log('intakes', intakes.rows)
  console.log('deliveries', dels.rows)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
