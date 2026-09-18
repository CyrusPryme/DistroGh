import 'dotenv/config'
import pg from 'pg'

const PID = '21c88670-ce6f-4f3c-a95d-8a8192086495'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows: runs } = await pool.query(
    `
    SELECT DISTINCT dr.id, dr.delivery_date::text, dr.total_transport_cost,
      (SELECT COUNT(*)::int FROM delivery_run_items WHERE delivery_run_id = dr.id) AS item_count
    FROM delivery_run_items dri
    JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
    WHERE dri.product_id = $1::uuid
    `,
    [PID]
  )
  console.log('runs', runs)
  for (const r of runs) {
    const items = await pool.query(
      `SELECT dri.quantity_delivered, p.name, v.name AS vendor FROM delivery_run_items dri
       JOIN products p ON p.id = dri.product_id JOIN vendors v ON v.id = p.vendor_id
       WHERE dri.delivery_run_id = $1::uuid`,
      [r.id]
    )
    const charges = await pool.query(
      `SELECT c.*, v.name FROM delivery_run_vendor_charges c JOIN vendors v ON v.id = c.vendor_id
       WHERE c.delivery_run_id = $1::uuid`,
      [r.id]
    )
    console.log('items', items.rows, 'charges', charges.rows)
  }
  await pool.end()
}

main()
