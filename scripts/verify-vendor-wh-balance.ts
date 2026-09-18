import 'dotenv/config'
import pg from 'pg'

const vendors = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['EDICE VENTURES', 'MEERA PASTES HAKAMA COMPANY LIMITED', 'CLEANING SOLUTION LIMITED']

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  for (const vn of vendors) {
    const { rows } = await pool.query<{
      name: string
      received: number
      delivered: number
      wh: number
    }>(
      `
      SELECT p.name,
        COALESCE((SELECT SUM(quantity_received) FROM intakes i WHERE i.deleted_at IS NULL AND i.product_id = p.id),0)::int AS received,
        COALESCE((SELECT SUM(dri.quantity_delivered) FROM delivery_run_items dri
          JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
          WHERE dri.product_id = p.id),0)::int AS delivered,
        GREATEST(0,
          COALESCE((SELECT SUM(quantity_received) FROM intakes i WHERE i.deleted_at IS NULL AND i.product_id = p.id),0)
          - COALESCE((SELECT SUM(dri.quantity_delivered) FROM delivery_run_items dri
            JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
            WHERE dri.product_id = p.id),0)
        )::int AS wh
      FROM products p
      JOIN vendors v ON v.id = p.vendor_id
      WHERE p.deleted_at IS NULL AND v.deleted_at IS NULL AND v.name ILIKE $1
        AND (
          COALESCE((SELECT SUM(quantity_received) FROM intakes i WHERE i.deleted_at IS NULL AND i.product_id = p.id),0) > 0
          OR COALESCE((SELECT SUM(dri.quantity_delivered) FROM delivery_run_items dri
            JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
            WHERE dri.product_id = p.id),0) > 0
        )
      ORDER BY p.name
      `,
      [`%${vn.split(' ')[0]}%`]
    )
    console.log('\n', vn)
    for (const r of rows) {
      const flag = r.received !== r.delivered ? ' MISMATCH' : ''
      console.log(`  ${r.name.slice(0, 40)} recv=${r.received} del=${r.delivered} wh=${r.wh}${flag}`)
    }
  }
  await pool.end()
}

main()
