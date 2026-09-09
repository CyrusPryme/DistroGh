/**
 * Validate payouts migration source against production vendors and balances.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/analyze-payouts-migration-file.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/analyze-payouts-migration-file.ts dotenv_config_path=.env.local --file "payouts migration/migration-payouts-template 2nd.xlsx"
 */
import 'dotenv/config'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'
import { migrationStr } from '@/lib/migration/fix-workbook'

const PAYOUTS_DIR = resolve(process.cwd(), 'payouts migration')

function pickInput(): string {
  const fileIdx = process.argv.indexOf('--file')
  if (fileIdx >= 0 && process.argv[fileIdx + 1]) {
    const p = resolve(process.cwd(), process.argv[fileIdx + 1]!)
    if (!existsSync(p)) throw new Error(`File not found: ${p}`)
    return p
  }
  const candidates = readdirSync(PAYOUTS_DIR)
    .filter(
      (f) =>
        f.endsWith('.xlsx') &&
        !f.startsWith('~$') &&
        f !== 'payouts-TEMPLATE.xlsx' &&
        f !== 'payouts-UPLOAD.xlsx'
    )
    .map((f) => join(PAYOUTS_DIR, f))
    .sort()
  const pending = candidates.filter((p) => !basename(p).startsWith('payouts-UPLOAD'))
  if (!pending.length) throw new Error(`No payout batch file in ${PAYOUTS_DIR}`)
  return pending[pending.length - 1]!
}

async function main() {
  const input = pickInput()
  const { rows } = await parseWorkbook(readFileSync(input))
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: vendors } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM vendors WHERE deleted_at IS NULL`
  )
  const vendorByLower = new Map(vendors.map((v) => [v.name.trim().toLowerCase(), v]))

  const { rows: balances } = await pool.query<{ vendor_id: string; balance: string }>(
    `SELECT vendor_id::text, balance::text FROM reporting.vendor_balances`
  )
  const balanceByVendor = new Map(balances.map((b) => [b.vendor_id, Number(b.balance)]))

  console.log('=== PAYOUTS FILE ANALYSIS ===')
  console.log('File:', input)
  console.log('Rows:', rows.length)

  let totalPaid = 0
  const issues: string[] = []
  const byVendor = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const vendor = migrationStr(row.vendor_name)
    const paid = Number(row.amount_paid ?? row.amount)
    const date = migrationStr(row.payout_date ?? row.week_start)
    const r = i + 2

    if (!vendor) issues.push(`R${r}: missing vendor_name`)
    if (!Number.isFinite(paid) || paid <= 0) issues.push(`R${r} ${vendor}: invalid amount_paid`)
    if (!date) issues.push(`R${r} ${vendor}: missing payout_date`)

    const v = vendor ? vendorByLower.get(vendor.toLowerCase()) : undefined
    if (vendor && !v) issues.push(`R${r} ${vendor}: vendor not in production`)

    if (Number.isFinite(paid) && paid > 0) {
      totalPaid += paid
      if (v) byVendor.set(v.id, (byVendor.get(v.id) ?? 0) + paid)
    }
  }

  console.log('\n=== TOTALS ===')
  console.log('Total amount_paid in file:', totalPaid.toFixed(2), 'GHS')
  console.log('Vendors with rows:', byVendor.size)

  console.log('\n=== POST-IMPORT BALANCE PREVIEW (approx) ===')
  for (const [vendorId, payoutSum] of byVendor) {
    const v = vendors.find((x) => x.id === vendorId)!
    const cur = balanceByVendor.get(vendorId) ?? 0
    const after = cur - payoutSum
    console.log(`  ${v.name}: balance ${cur.toFixed(2)} → ${after.toFixed(2)} (import ${payoutSum.toFixed(2)})`)
  }

  if (issues.length) {
    console.log('\n=== ISSUES ===')
    issues.forEach((x) => console.log(' ', x))
  } else {
    console.log('\nNo blocking issues — ready for migration import.')
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
