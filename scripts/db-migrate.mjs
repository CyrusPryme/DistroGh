import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'

const migrationsDir = path.join(process.cwd(), 'db', 'migrations')
if (!fs.existsSync(migrationsDir)) {
  console.error(`Missing migrations directory at ${migrationsDir}`)
  process.exit(1)
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b))

const pool = new Pool({ connectionString: DATABASE_URL })

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
}

async function hasMigration(client, id) {
  const res = await client.query('SELECT 1 FROM public._migrations WHERE id = $1', [id])
  return res.rowCount > 0
}

async function markMigration(client, id) {
  await client.query('INSERT INTO public._migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [id])
}

async function run() {
  const client = await pool.connect()
  try {
    await ensureMigrationsTable(client)

    for (const file of files) {
      if (await hasMigration(client, file)) continue

      const fullPath = path.join(migrationsDir, file)
      const sql = fs.readFileSync(fullPath, 'utf8')

      console.log(`Applying ${file}...`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await markMigration(client, file)
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }
    }

    console.log('Migrations complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

