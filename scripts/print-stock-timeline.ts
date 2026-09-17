/**
 * Print stock timeline for named products (read-only).
 * Usage: npx tsx -r dotenv/config scripts/print-stock-timeline.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import pg from 'pg'
import { fetchStockTimeline } from '@/lib/vendor-stock-timeline'

const NAMES = ['AUNTY LULUS SHITO 200G', 'AUNTY LULUS GREEN CHILLI 200G']

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  for (const name of NAMES) {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM products WHERE deleted_at IS NULL AND lower(name) = lower($1) LIMIT 1`,
      [name]
    )
    const p = rows[0]
    if (!p) {
      console.log('\n=== NOT FOUND:', name)
      continue
    }
    const { events, summary } = await fetchStockTimeline(pool, p.id, null, null)
    console.log('\n===', p.name, '===')
    console.log('Summary:', summary)
    console.log('Events:')
    for (const e of events) {
      const week = e.end_date ? `${e.sort_date}..${e.end_date}` : e.sort_date
      console.log(`  ${e.kind.padEnd(9)} ${week}  qty=${e.quantity}  ${e.destination ?? ''}  ${e.reference ?? ''}`)
    }
  }
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
