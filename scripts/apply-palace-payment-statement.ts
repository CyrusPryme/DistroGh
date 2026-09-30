/**
 * Reconciles `sales.supermarket_paid` for Palace (all 5 branches, pooled — Palace settles
 * centrally via Palace Spintex, individual branches don't pay separately) against a real bank
 * payment statement submitted by admin.
 *
 * Source file: "discrepancies fix/payment from palace-statement generated.xlsx"
 *   Columns: MONTH (statement date), BANK NAME, STATEMENT (GHS amount paid that period)
 *
 * Method: standard oldest-debt-first (FIFO) reconciliation.
 *   1. Sum every row in the statement -> total real cash paid by Palace, all-time.
 *   2. Pull every Palace sale line (all branches), oldest `week_end` first.
 *   3. Walk oldest-first, marking rows `supermarket_paid = true` while the running total stays
 *      within the real-cash budget. Everything after the cutoff stays/becomes `false`.
 *
 * Safety: this script only ever flips false -> true. If the computed set would require flipping
 * any currently-true row back to false (i.e. a row the system already recognizes as settled
 * falls outside the FIFO-safe window), it refuses to apply and prints the conflicting rows for
 * manual review instead of silently unsettling something an admin may already be relying on.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/apply-palace-payment-statement.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-palace-payment-statement.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'
import ExcelJS from 'exceljs'
import { writeAuditLog } from '../lib/rbac/audit'

const APPLY = process.argv.includes('--apply')
const SOURCE_FILE = 'discrepancies fix/payment from palace-statement generated.xlsx'

function parseDdMmYyyy(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  const [d, m, y] = s.split('-')
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

async function loadStatementTotal(): Promise<{ total: number; rows: { date: string; bank: string; amount: number }[] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(SOURCE_FILE)
  const sheet = wb.worksheets[0]
  const rows: { date: string; bank: string; amount: number }[] = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const dateRaw = row.getCell(1).value
    const bank = row.getCell(2).value
    const amount = row.getCell(3).value
    if (!dateRaw) continue
    rows.push({ date: parseDdMmYyyy(dateRaw), bank: String(bank), amount: Number(amount) })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
  return { total, rows }
}

async function main() {
  const { total: totalPaid, rows: statementRows } = await loadStatementTotal()
  console.log(`Source: ${SOURCE_FILE}`)
  console.log(`Statement rows: ${statementRows.length} (${statementRows[0].date} .. ${statementRows[statementRows.length - 1].date})`)
  console.log(`TOTAL real cash paid by Palace, all-time: GHS ${totalPaid.toFixed(2)}\n`)

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()

  try {
    const { rows: sales } = await client.query<{
      id: string
      branch: string
      week_end: string
      total_sales: string
      supermarket_paid: boolean
    }>(`
      select s.id, sm.branch, s.week_end::text, s.total_sales::text, s.supermarket_paid
      from public.sales s
      join public.supermarkets sm on sm.id = s.supermarket_id
      where sm.name = 'PALACE' and s.deleted_at is null
      order by s.week_end asc, s.id asc
    `)

    let cumulative = 0
    let cutoffIndex = -1
    for (let i = 0; i < sales.length; i++) {
      const amt = Number(sales[i].total_sales)
      if (cumulative + amt > totalPaid) break
      cumulative += amt
      cutoffIndex = i
    }
    const remainder = Math.round((totalPaid - cumulative) * 100) / 100

    const flipToTrue = sales.filter((s, i) => i <= cutoffIndex && !s.supermarket_paid)
    const flipToFalse = sales.filter((s, i) => i > cutoffIndex && s.supermarket_paid)
    const flipToTrueAmt = flipToTrue.reduce((s, r) => s + Number(r.total_sales), 0)
    const flipToFalseAmt = flipToFalse.reduce((s, r) => s + Number(r.total_sales), 0)

    console.log(`Total Palace sales (all branches, all-time): ${sales.length} lines, GHS ${sales.reduce((s, r) => s + Number(r.total_sales), 0).toFixed(2)}`)
    console.log(`FIFO-settled window: ${cutoffIndex + 1} of ${sales.length} lines, GHS ${cumulative.toFixed(2)} (unallocated remainder GHS ${remainder.toFixed(2)})`)
    console.log(`\nProposed: flip false->true: ${flipToTrue.length} rows, GHS ${flipToTrueAmt.toFixed(2)}`)
    console.log(`Proposed: flip true->false: ${flipToFalse.length} rows, GHS ${flipToFalseAmt.toFixed(2)}`)

    if (flipToFalse.length > 0) {
      console.log(
        '\n⚠ SAFETY STOP: this would unsettle rows the system currently marks as paid. Refusing to auto-apply.'
      )
      console.log('Conflicting rows (first 20):', flipToFalse.slice(0, 20))
      console.log('Resolve manually — this script only ever flips false -> true automatically.')
      return
    }

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to write these changes.')
      return
    }

    if (flipToTrue.length === 0) {
      console.log('\nNothing to apply — already fully reconciled against this statement.')
      return
    }

    await client.query('begin')
    const ids = flipToTrue.map((r) => r.id)
    const result = await client.query(
      `update public.sales set supermarket_paid = true, updated_at = now() where id = any($1::uuid[])`,
      [ids]
    )
    await writeAuditLog(client, {
      actor_email: 'system-script:apply-palace-payment-statement',
      action: 'bulk_settle_from_bank_statement',
      module: 'sales',
      target_label: 'PALACE (all branches)',
      metadata: {
        source_file: SOURCE_FILE,
        statement_total_paid: totalPaid,
        rows_flipped_to_settled: result.rowCount,
        amount_flipped_to_settled: Math.round(flipToTrueAmt * 100) / 100,
        fifo_cutoff_week_end: sales[cutoffIndex]?.week_end ?? null,
        unallocated_remainder: remainder,
      },
    })
    await client.query('commit')
    console.log(`\n✅ Applied: ${result.rowCount} rows marked supermarket_paid = true (GHS ${flipToTrueAmt.toFixed(2)})`)
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
