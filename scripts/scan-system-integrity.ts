/**
 * Full production database integrity scan.
 * Usage: npx tsx -r dotenv/config scripts/scan-system-integrity.ts dotenv_config_path=.env.local
 *
 * Same checks as the Platform > Data Integrity dashboard (/dashboard/platform/data-integrity) —
 * this script and the `/api/developer/system-integrity` route both call
 * `runSystemIntegrityScan()` in lib/system-integrity.ts, so there is one source of truth.
 */
import 'dotenv/config'
import pg from 'pg'
import { runSystemIntegrityScan } from '@/lib/system-integrity'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  console.log('=== FULL SYSTEM INTEGRITY SCAN ===')
  console.log('Database:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') ?? '(none)')
  console.log('Time:', new Date().toISOString())

  const result = await runSystemIntegrityScan(pool)

  console.log('\n=== OPERATIONAL RECORD COUNTS ===')
  console.log(result.counts)

  const errors = result.issues.filter((i) => i.severity === 'error')
  const warns = result.issues.filter((i) => i.severity === 'warn')
  const infos = result.issues.filter((i) => i.severity === 'info')

  console.log('\n=== FINDINGS ===')
  for (const i of [...errors, ...warns, ...infos]) {
    const prefix = i.severity === 'error' ? 'ERROR' : i.severity === 'warn' ? 'WARN ' : 'OK   '
    console.log(`${prefix} [${i.area}] ${i.message}${i.count != null ? ` (${i.count})` : ''}`)
  }

  console.log('\n=== VERDICT ===')
  if (result.verdict === 'not_solid') {
    console.log(`NOT SOLID — ${errors.length} error(s), ${warns.length} warning(s)`)
    process.exitCode = 1
  } else if (result.verdict === 'functional') {
    console.log(`FUNCTIONAL with ${warns.length} warning(s) — no blocking errors`)
  } else {
    console.log('SOLID — stock chain balanced, no blocking integrity issues')
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
