import 'dotenv/config'
import { Pool } from 'pg'

const migrationId = process.argv[2]
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment',
})

async function main() {
  const total = await pool.query(`SELECT COUNT(*)::int AS c FROM public.products WHERE deleted_at IS NULL`)
  console.log('Total active products in production:', total.rows[0].c)

  const sample = await pool.query(
    `SELECT row_number, raw_data->>'name' AS name FROM public.migration_staging_rows
     WHERE migration_id = $1 ORDER BY row_number ASC LIMIT 8`,
    [migrationId]
  )
  console.log('Sample staged product names:')
  for (const r of sample.rows) {
    const match = await pool.query(
      `SELECT id, name, created_at FROM public.products WHERE lower(trim(name)) = lower(trim($1)) AND deleted_at IS NULL`,
      [r.name]
    )
    console.log(`  row ${r.row_number} "${r.name}" ->`, match.rows.length ? JSON.stringify(match.rows) : 'NOT FOUND IN PRODUCTION')
  }

  const recentProducts = await pool.query(
    `SELECT COUNT(*)::int AS c FROM public.products WHERE created_at > '2026-08-11T15:00:00Z'`
  )
  console.log('Products created anywhere in the system after 15:00 UTC today:', recentProducts.rows[0].c)

  const stagingImported = await pool.query(
    `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows WHERE migration_id = $1 AND production_id IS NOT NULL`,
    [migrationId]
  )
  console.log('Staging rows with a production_id set (i.e. actually imported):', stagingImported.rows[0].c)

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
