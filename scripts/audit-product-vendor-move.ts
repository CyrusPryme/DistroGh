/**
 * Audit product before vendor reassignment.
 * Usage: npx tsx -r dotenv/config scripts/audit-product-vendor-move.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import pg from 'pg'

const PRODUCT_PATTERN = '%Hausa%Koko%'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: products } = await pool.query<{
    id: string
    name: string
    barcode: string | null
    vendor_id: string
    vendor_name: string
  }>(
    `
    SELECT p.id, p.name, p.barcode, p.vendor_id, v.name AS vendor_name
    FROM products p
    JOIN vendors v ON v.id = p.vendor_id
    WHERE p.deleted_at IS NULL AND p.name ILIKE $1
    ORDER BY v.name, p.name
    `,
    [PRODUCT_PATTERN]
  )
  console.log('Matching products:', products)

  for (const p of products) {
    const pid = p.id
    const counts = await pool.query<Record<string, number>>(
      `
      SELECT
        (SELECT COUNT(*)::int FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid) AS intakes,
        (SELECT COUNT(*)::int FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid AND vendor_id <> $2::uuid) AS intakes_vendor_mismatch,
        (SELECT COALESCE(SUM(quantity_received),0)::int FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid) AS intake_units,
        (SELECT COUNT(*)::int FROM sales WHERE deleted_at IS NULL AND product_id = $1::uuid) AS sales,
        (SELECT COALESCE(SUM(qty_sold),0)::int FROM sales WHERE deleted_at IS NULL AND product_id = $1::uuid) AS sold_units,
        (SELECT COUNT(*)::int FROM product_returns WHERE deleted_at IS NULL AND product_id = $1::uuid) AS returns,
        (SELECT COUNT(*)::int FROM delivery_run_items dri
          JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
          WHERE dri.product_id = $1::uuid) AS delivery_items,
        (SELECT COALESCE(SUM(dri.quantity_delivered),0)::int FROM delivery_run_items dri
          JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
          WHERE dri.product_id = $1::uuid) AS delivered_units,
        (SELECT COUNT(*)::int FROM supermarket_inventory WHERE product_id = $1::uuid) AS inventory_rows
      `,
      [pid, p.vendor_id]
    )
    console.log('\nCounts for', p.name, '@', p.vendor_name, counts.rows[0])

    const { rows: meeraDup } = await pool.query(
      `
      SELECT p.id, p.name, p.barcode FROM products p
      JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
      WHERE p.deleted_at IS NULL AND v.id = $1::uuid
        AND (p.barcode IS NOT DISTINCT FROM $2::text OR lower(p.name) LIKE '%hausa%koko%1kg%')
      `,
      ['58acd10e-6ada-4db8-b598-d44365ea36bc', p.barcode]
    )
    console.log('Meera Pastes Hakama possible duplicates:', meeraDup)
  }

  const { rows: vendors } = await pool.query(
    `SELECT id, name FROM vendors WHERE deleted_at IS NULL AND (
      lower(name) LIKE '%afrizone%' OR lower(name) LIKE '%meera%'
    ) ORDER BY name`
  )
  console.log('\nVendors:', vendors)

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
