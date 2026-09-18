import 'dotenv/config'
import pg from 'pg'

const PID = '21c88670-ce6f-4f3c-a95d-8a8192086495'
const MEERA = '58acd10e-6ada-4db8-b598-d44365ea36bc'
const AFRIZONE = '9636b474-581e-476e-aaa8-0004fd635a17'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows: p } = await pool.query(
    `SELECT p.name, v.name AS vendor FROM products p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = $1::uuid`,
    [PID]
  )
  console.log('Product vendor:', p[0])

  for (const [label, vid] of [
    ['Meera', MEERA],
    ['Afrizone', AFRIZONE],
  ] as const) {
    const { rows } = await pool.query(
      `
      SELECT
        (SELECT COALESCE(SUM(quantity_received),0)::int FROM intakes i WHERE i.deleted_at IS NULL AND i.product_id = $2::uuid AND i.vendor_id = $1::uuid) AS intake_units,
        (SELECT COALESCE(SUM(s.qty_sold),0)::int FROM sales s JOIN products pr ON pr.id = s.product_id WHERE s.deleted_at IS NULL AND s.product_id = $2::uuid AND pr.vendor_id = $1::uuid) AS sold_via_product_vendor,
        (SELECT COUNT(*)::int FROM sales s WHERE s.deleted_at IS NULL AND s.product_id = $2::uuid) AS sales_rows
      `,
      [vid, PID]
    )
    console.log(label, rows[0])
  }
  await pool.end()
}

main()
