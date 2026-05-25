/**
 * Generate sample sales CSV using local Postgres (DATABASE_URL).
 * Usage: node -r dotenv/config scripts/generate-sample-sales.mjs dotenv_config_path=.env.local
 */
import pg from 'pg'
import { writeFileSync } from 'node:fs'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment',
})

async function main() {
  const { rows: products } = await pool.query(
    `select p.id, p.name, p.vendor_price, p.distrogh_markup, v.name as vendor_name
     from public.products p
     join public.vendors v on v.id = p.vendor_id
     where p.deleted_at is null and v.deleted_at is null
     limit 50`
  )
  const { rows: supermarkets } = await pool.query(
    `select id, name from public.supermarkets where deleted_at is null limit 20`
  )

  if (!products.length || !supermarkets.length) {
    console.error('Need products and supermarkets in the database. Run npm run db:seed first.')
    process.exit(1)
  }

  const lines = ['product_name,supermarket_name,qty_sold,week_start,week_end']
  for (let i = 0; i < 30; i++) {
    const p = products[i % products.length]
    const sm = supermarkets[i % supermarkets.length]
    const qty = 1 + (i % 10)
    lines.push([p.name, sm.name, qty, '2026-01-06', '2026-01-12'].join(','))
  }

  const out = 'sample-sales-import.csv'
  writeFileSync(out, lines.join('\n'), 'utf8')
  console.log(`Wrote ${out} (${lines.length - 1} rows)`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
