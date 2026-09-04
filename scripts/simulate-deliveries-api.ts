/**
 * Simulate GET /api/deliveries admin query against production.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import { DELIVERY_RUN_LIST_SELECT } from '@/lib/delivery-run-sql'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const { rows } = await pool.query(
    `
    select ${DELIVERY_RUN_LIST_SELECT}
    from public.delivery_runs dr
    left join public.supermarkets sm on sm.id = dr.supermarket_id
    where dr.deleted_at is null
      and ($1::uuid is null or dr.supermarket_id = $1::uuid)
      and ($2::date is null or dr.delivery_date >= $2::date)
      and ($3::date is null or dr.delivery_date <= $3::date)
      and ($4::boolean is false or dr.confirmed_at is not null)
    order by dr.delivery_date desc
    limit 20000
    `,
    [null, null, null, false]
  )
  console.log('Admin API would return:', rows.length, 'runs')
  if (rows[0]) {
    console.log('First run:', {
      id: rows[0].id,
      date: rows[0].delivery_date,
      supermarket: rows[0].supermarket,
      items: Array.isArray(rows[0].items) ? rows[0].items.length : rows[0].items,
      confirmed_at: rows[0].confirmed_at,
      source: rows[0].source,
    })
  }

  const staging = await pool.query(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE production_id IS NOT NULL)::int with_prod
     FROM migration_staging_rows
     WHERE migration_id = '0c448e7b-f14c-4469-8e4d-48b8809f81db'`
  )
  console.log('Staging production_id:', staging.rows[0])

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
