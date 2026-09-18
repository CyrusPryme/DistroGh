import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const ROWS = [
  ['CSL PERFUMED LAUNDRY DETERGENT', '2026-01-30', 1],
  ['CSL STRONG SCOURING POWDER', '2025-10-18', 120],
  ['CSL OMNICIDE BIO SECURITY POWDER', '2026-01-30', 1],
  ['EDICE GINGER SPICE 200G', '2025-06-30', 88],
  ['EDICE MIXED SPICE 200G', '2025-06-30', 20],
  ['EDICE GINGER SPICE 200G', '2025-05-18', 92],
  ['EDICE MIXED SPICE 200G', '2025-05-18', 125],
  ['EDICE GINGER SPICE 200G', '2025-07-08', null],
  ['EDICE MIXED SPICE 200G', '2025-07-08', null],
  ['PALMNUT SOUP BASE 1KG', '2025-06-02', 1],
  ['PALMNUT TURKEY BERRY SOUP BASE', '2025-06-26', 1],
] as const

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const sp = await resolvePalaceSpintexId(pool)
  for (const [name, date, qty] of ROWS) {
    const { rows: p } = await pool.query<{ id: string }>(
      `SELECT id FROM products WHERE deleted_at IS NULL AND trim(name) ILIKE trim($1) LIMIT 1`,
      [name]
    )
    if (!p[0]) {
      console.log(name, 'NOT FOUND')
      continue
    }
    const pid = p[0].id
    const intakes = await pool.query(
      `SELECT id, received_date::text, quantity_received FROM intakes WHERE deleted_at IS NULL AND product_id=$1::uuid AND received_date=$2::date`,
      [pid, date]
    )
    const dels = await pool.query(
      `SELECT dr.id, dr.delivery_date::text, dri.quantity_delivered FROM delivery_run_items dri
       JOIN delivery_runs dr ON dr.id=dri.delivery_run_id AND dr.deleted_at IS NULL
       WHERE dri.product_id=$1::uuid AND dr.supermarket_id=$2::uuid AND dr.delivery_date=$3::date`,
      [pid, sp, date]
    )
    const allDel = await pool.query(
      `SELECT dr.id, dr.delivery_date::text, dri.quantity_delivered FROM delivery_run_items dri
       JOIN delivery_runs dr ON dr.id=dri.delivery_run_id AND dr.deleted_at IS NULL
       WHERE dri.product_id=$1::uuid AND dr.supermarket_id=$2::uuid ORDER BY dr.delivery_date`,
      [pid, sp]
    )
    const { rows: chain } = await pool.query(
      `SELECT
        (SELECT COALESCE(SUM(quantity_received),0)::int FROM intakes WHERE deleted_at IS NULL AND product_id=$1) r,
        (SELECT COALESCE(SUM(dri.quantity_delivered),0)::int FROM delivery_run_items dri JOIN delivery_runs dr ON dr.id=dri.delivery_run_id AND dr.deleted_at IS NULL WHERE dri.product_id=$1) d`,
      [pid]
    )
    console.log('\n', name, 'recv/del totals', chain[0], 'intakes', intakes.rows, 'del@date', dels.rows, 'allDel', allDel.rows)
  }
  await pool.end()
}

main()
