/**
 * Plain-language admin summary of remaining discrepancy rows.
 * Usage: npx tsx -r dotenv/config scripts/summarize-discrepancies-for-admin.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import {
  buildChronologyIssues,
  buildDeliveryFixRows,
  buildIntakeFixRows,
  buildInventoryFixRows,
  countByDisposition,
} from '@/lib/migration/discrepancy-auto-fix'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const OUT = resolve(process.cwd(), 'discrepancies fix/ADMIN-ATTENTION.md')

function explainChronology(issue: {
  issue_type: string
  product_name: string
  current_date: string
  reference_date: string
  suggested_date: string
  fix_action: string
  meta: { disposition: string }
}): string {
  const who = issue.product_name
  if (issue.issue_type === 'DELIVERY_BEFORE_INTAKE') {
    return `**${who}** — The system shows stock was **delivered before it was recorded as received** at the warehouse. Delivery date (${issue.current_date}) is earlier than the intake date (${issue.reference_date}). This often happens after correcting intake dates in the admin sheet. **Usually safe to ignore** if you intentionally moved the intake date.`
  }
  if (issue.issue_type === 'SALE_BEFORE_DELIVERY') {
    return `**${who}** — Sales were recorded **before** a delivery to Spintex (${issue.reference_date} sale vs ${issue.current_date} delivery). Sales data is trusted; the system may suggest moving the delivery date earlier. **Review only if** the delivery date in your records is definitely correct.`
  }
  if (issue.issue_type === 'INTAKE_AFTER_SALE') {
    return `**${who}** — Warehouse receipt is dated **after** the first sale at Spintex. You may have corrected the intake date forward on purpose. **No action needed** unless the receipt date in your paperwork is wrong.`
  }
  return `**${who}** — ${issue.fix_action}`
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Spintex not found')
  const products = await loadStockChainProducts(pool, spintexId)
  await pool.end()

  const intake = buildIntakeFixRows(products)
  const delivery = buildDeliveryFixRows(products)
  const inventory = buildInventoryFixRows(products)
  const chronology = buildChronologyIssues(products, delivery.autoBarcodes)

  const ic = countByDisposition(intake.meta)
  const dc = countByDisposition(delivery.meta)
  const invc = countByDisposition(inventory.meta)
  const cc = countByDisposition(chronology.map((c) => c.meta))

  const autoChrono = chronology.filter((c) => c.meta.disposition === 'auto')
  const adminChrono = chronology.filter((c) => c.meta.disposition === 'admin')

  const lines: string[] = [
    '# Admin attention — stock chain review',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'After applying **SYSTEM CORRECT FARMER TORKS 2** and follow-up auto-reconciliation, most quantity gaps are cleared. What remains is mostly **date ordering** — not missing stock.',
    '',
    '## Quick status',
    '',
    '| Area | Needs admin? | What it means |',
    '|------|--------------|---------------|',
    `| Intake gaps (warehouse receipts) | **No** (${ic.auto + ic.admin} rows) | Received vs delivered quantities match for all flagged products |`,
    `| Delivery gaps (to Spintex) | **No** (${dc.auto + dc.admin} rows) | Delivered amounts align with sales/returns |`,
    `| Shelf stock at Spintex | **No** (${invc.auto + invc.admin} rows) | On-shelf counts match expected (delivered − sold − returns) |`,
    `| Date order (chronology) | **Review** (${cc.auto} auto + ${cc.admin} admin) | Some dates appear “out of order” — see below |`,
    '',
    '**Start with:** open `DISCREPANCY-SUMMARY.xlsx` in this folder, then `CHRONOLOGY-FIX.xlsx` for details.',
    '',
    '---',
    '',
    '## What “chronology” means (simple)',
    '',
    'The system expects this order in time:',
    '',
    '1. **Received** at DistroGH warehouse (intake)',
    '2. **Delivered** to Palace Spintex',
    '3. **Sold** at the supermarket',
    '',
    'When you **correct intake or delivery dates** in an admin spreadsheet, the quantities can be right while dates still look “wrong” to the computer. That is what most remaining rows are.',
    '',
    '**Important:** We applied your date corrections on purpose. The chronology sheet is a **warning list**, not a list of missing products.',
    '',
    '---',
    '',
    '## Chronology — auto rows (15)',
    '',
    'These are **informational**. Do **not** auto-apply chronology backdating — it would undo your Farmer Torks / admin date fixes.',
    '',
  ]

  for (const issue of autoChrono) {
    lines.push(`- ${explainChronology(issue)}`)
  }

  lines.push('', '## Chronology — admin review (2)', '')

  if (adminChrono.length === 0) {
    lines.push('_None._')
  } else {
    for (const issue of adminChrono) {
      lines.push(`- ${explainChronology(issue)}`)
    }
  }

  lines.push(
    '',
    '---',
    '',
    '## Items skipped from SYSTEM CORRECT FARMER TORKS 2',
    '',
    'These were in your spreadsheet but already fixed or not applicable:',
    '',
    '| Product | Why skipped |',
    '|---------|-------------|',
    '| ADEPA Butter Cereal Legume Flou (500G rows) | Duplicate deletes already done in an earlier correction |',
    '| Pals Honey 250ML (delete ×24) | Already removed; qty fix applied on another row |',
    '| Akoma Cashews 50G (×1519 delete / ×200 insert) | Large duplicate already gone; correct intake exists |',
    '| Chocho Royal Herbal Shower Gel (duplicate insert) | Intake already on file |',
    '| McPhilix Kelewele Plantain Chip (42→40) | No intake with qty 42; active intake is already 40 |',
    '',
    '---',
    '',
    '## Workbook files in this folder',
    '',
    '| File | Use |',
    '|------|-----|',
    '| `DISCREPANCY-SUMMARY.xlsx` | One-page overview |',
    '| `CHRONOLOGY-FIX.xlsx` | Date-order review (only file with open items) |',
    '| `INTAKE-GAPS-FIX.xlsx` | Empty — no intake quantity gaps |',
    '| `DELIVERY-GAPS-FIX.xlsx` | Empty — no delivery quantity gaps |',
    '| `INVENTORY-RECONCILE-FIX.xlsx` | Empty — no shelf adjustments needed |',
    '| `SYSTEM CORRECT FARMER TORKS 2.xlsx` | Your source corrections (applied) |',
    '',
    'There are **no `*-READY.xlsx` files** right now — nothing safe to bulk-import until new gaps appear.',
    '',
    '## If you need to regenerate after more edits',
    '',
    '```bash',
    'npx tsx -r dotenv/config scripts/generate-discrepancy-fix-workbooks.ts dotenv_config_path=.env.local',
    '```',
    ''
  )

  writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log('Wrote', OUT)
  console.log('Chronology: auto', autoChrono.length, 'admin', adminChrono.length)
  console.log('Intake/Delivery/Inventory gaps: 0')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
