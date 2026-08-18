import fs from 'node:fs'
import pg from 'pg'

const { Pool } = pg

async function check(label, url) {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 8000 })
  try {
    const mig = await pool.query(
      `SELECT id, applied_at FROM public._migrations
       WHERE id LIKE '%032%' OR id LIKE '%031%'
       ORDER BY id`
    )
    const sales = await pool.query(
      `SELECT required_columns, optional_columns, left(description, 140) AS description
       FROM public.migration_templates WHERE entity_type = 'sales'`
    )
    console.log(`\n=== ${label} ===`)
    if (mig.rows.length) {
      console.log('Sales-related migrations applied:')
      for (const r of mig.rows) console.log(`  ${r.id} @ ${r.applied_at}`)
    } else {
      console.log('Sales-related migrations applied: (none — DB may be empty/unmigrated)')
    }
    const row = sales.rows[0]
    if (!row) {
      console.log('migration_templates sales row: MISSING')
      return
    }
    console.log('sales required_columns:', JSON.stringify(row.required_columns))
    console.log('sales optional_columns:', JSON.stringify(row.optional_columns))
    console.log('sales description:', row.description)
    const has032 = mig.rows.some((r) => String(r.id).includes('032'))
    const req = row.required_columns ?? []
    const palace = req.includes('store_name') && req.includes('TCostEx') && req.includes('description')
    console.log('032 applied:', has032 ? 'YES' : 'NO')
    console.log('Palace template in DB:', palace ? 'YES' : 'NO')
  } catch (e) {
    console.log(`\n=== ${label} ===`)
    console.log('ERROR:', e.message)
  } finally {
    await pool.end()
  }
}

const localUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'
await check('Local Docker (default)', localUrl)

if (fs.existsSync('.env.local')) {
  const text = fs.readFileSync('.env.local', 'utf8')
  const match = text.match(/^DATABASE_URL=(.+)$/m)
  const prodUrl = match?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (prodUrl) await check('Production (.env.local Neon)', prodUrl)
  else console.log('\n=== Production (.env.local) ===\nDATABASE_URL not found in .env.local')
} else {
  console.log('\n=== Production (.env.local) ===\n.env.local not found')
}
