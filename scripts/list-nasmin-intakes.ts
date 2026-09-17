/** List NASMIN Aunty Lulu intakes (read-only). */
import 'dotenv/config'
import pg from 'pg'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows } = await pool.query<{
    product_name: string
    received_date: string
    quantity_received: number
    id: string
  }>(
    `
    SELECT p.name AS product_name, i.received_date::text, i.quantity_received, i.id
    FROM intakes i
    JOIN products p ON p.id = i.product_id
    JOIN vendors v ON v.id = p.vendor_id
    WHERE i.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL
      AND lower(v.name) LIKE '%nasmin%' AND p.name LIKE 'AUNTY LULU%'
    ORDER BY p.name, i.received_date, i.quantity_received
    `
  )
  for (const r of rows) {
    console.log(`${r.product_name} | ${r.received_date} | qty=${r.quantity_received} | ${r.id}`)
  }
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
