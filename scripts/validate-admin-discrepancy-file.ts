/**
 * Compare admin discrepancy fix workbook against production.
 * Usage: npx tsx -r dotenv/config scripts/validate-admin-discrepancy-file.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import pg from 'pg'
import { resolve } from 'node:path'
import { loadStockChainProducts, resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'
import { migrationStr } from '@/lib/migration/fix-workbook'

const ADMIN_FILE = resolve(process.cwd(), 'discrepancies fix/chronology fix admin.xlsx')

type AdminRow = {
  rowNum: number
  vendor_name: string
  product_name: string
  current_date: string
  corrected_date: string
  not_in_system: string
  receiving_qty: string
  current_qty: string
  corrected_qty: string
  notes: string
  barcode: string
  kind: 'date' | 'quantity' | 'date_and_qty' | 'quantity_only' | 'unclear'
}

function cellVal(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return String((v as { result?: unknown }).result ?? '').trim()
  }
  return String(v).trim()
}

function normalizeDate(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`
  }
  const m2 = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m2) return t.slice(0, 10)
  return t
}

async function loadAdminRows(): Promise<AdminRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ADMIN_FILE)
  const ws = wb.worksheets[0]
  const rows: AdminRow[] = []

  for (let r = 2; r <= (ws.rowCount || 0); r++) {
    const get = (col: number) => cellVal(ws.getRow(r).getCell(col).value)
    const vendor_name = get(1)
    const product_name = get(2)
    if (!vendor_name && !product_name) continue

    const current_date = get(3)
    const corrected_date = get(4)
    const not_in_system = get(5)
    const receiving_qty = get(6)
    const current_qty = get(7)
    const corrected_qty = get(8)
    const notes = get(9)
    const barcode = get(10)

    const hasDate = Boolean(current_date || corrected_date)
    const hasQty = Boolean(receiving_qty || current_qty || corrected_qty)
    let kind: AdminRow['kind'] = 'unclear'
    if (hasDate && hasQty) kind = 'date_and_qty'
    else if (hasDate) kind = 'date'
    else if (hasQty) kind = hasDate ? 'date_and_qty' : current_qty && corrected_qty ? 'quantity_only' : 'quantity'
    if (not_in_system) kind = 'unclear'

    rows.push({
      rowNum: r,
      vendor_name,
      product_name,
      current_date,
      corrected_date,
      not_in_system,
      receiving_qty,
      current_qty,
      corrected_qty,
      notes,
      barcode,
      kind,
    })
  }
  return rows
}

async function main() {
  const adminRows = await loadAdminRows()
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Spintex not found')

  const chain = await loadStockChainProducts(pool, spintexId)
  const byBarcode = new Map(chain.filter((p) => p.barcode).map((p) => [p.barcode!, p]))
  const byName = new Map(chain.map((p) => [p.product_name.toLowerCase(), p]))

  console.log('=== ADMIN FILE ANALYSIS ===')
  console.log('File:', ADMIN_FILE)
  console.log('Rows:', adminRows.length)
  console.log('By kind:', {
    date: adminRows.filter((r) => r.kind === 'date').length,
    quantity_only: adminRows.filter((r) => r.kind === 'quantity_only').length,
    date_and_qty: adminRows.filter((r) => r.kind === 'date_and_qty').length,
    quantity: adminRows.filter((r) => r.kind === 'quantity').length,
    unclear: adminRows.filter((r) => r.kind === 'unclear').length,
  })

  const issues: string[] = []
  const ok: string[] = []

  for (const row of adminRows) {
    const bc = migrationStr(row.barcode)
    const prod = (bc && byBarcode.get(bc)) || byName.get(row.product_name.toLowerCase())

    if (!prod && !bc) {
      issues.push(`R${row.rowNum} ${row.product_name}: product not found in production (no barcode)`)
      continue
    }
    if (!prod) {
      issues.push(`R${row.rowNum} ${row.product_name}: barcode ${bc} not in catalog`)
      continue
    }

    const parts: string[] = []

    if (row.current_date || row.corrected_date) {
      const cur = normalizeDate(row.current_date)
      const fix = normalizeDate(row.corrected_date)
      const { rows: intakes } = await pool.query<{ id: string; received_date: string; quantity_received: number }>(
        `SELECT i.id, i.received_date::text, i.quantity_received
         FROM intakes i JOIN products p ON p.id = i.product_id
         WHERE i.deleted_at IS NULL AND p.barcode = $1
         ORDER BY i.received_date, i.quantity_received`,
        [prod.barcode]
      )
      const matchDate = cur
        ? intakes.filter((i) => i.received_date.startsWith(cur.slice(0, 10)))
        : intakes
      if (row.kind === 'date' || row.kind === 'date_and_qty') {
        if (!matchDate.length) {
          parts.push(`date: no intake on ${cur ?? '?'} (have ${intakes.length} intakes: ${intakes.map((i) => `${i.received_date.slice(0, 10)}×${i.quantity_received}`).join(', ') || 'none'})`)
        } else if (fix) {
          parts.push(`date: ${matchDate.length} intake(s) on ${cur} → admin wants ${fix}`)
        }
      }
    }

    if (row.current_qty || row.corrected_qty) {
      const curQ = Number(row.current_qty)
      const fixQ = Number(row.corrected_qty)
      if (Number.isFinite(curQ) && Number.isFinite(fixQ) && curQ !== fixQ) {
        const { rows: matching } = await pool.query<{ quantity_received: number; received_date: string }>(
          `SELECT quantity_received, received_date::text FROM intakes i
           JOIN products p ON p.id = i.product_id
           WHERE i.deleted_at IS NULL AND p.barcode = $1 AND i.quantity_received = $2`,
          [prod.barcode, curQ]
        )
        if (matching.length) {
          parts.push(`qty: intake ${curQ} → ${fixQ} (${matching.length} record(s) at ${matching.map((m) => m.received_date.slice(0, 10)).join(', ')})`)
        } else {
          const totalReceived = prod.received
          parts.push(`qty: no intake with qty=${curQ} (total received=${totalReceived}); admin wants ${fixQ}`)
        }
      }
    }

    if (row.receiving_qty && !row.current_qty) {
      parts.push(`new/add intake qty=${row.receiving_qty}${row.corrected_date ? ` date=${normalizeDate(row.corrected_date)}` : ''}`)
    }

    // Chain context
    const gap = prod.sold_palace + prod.returned_palace - prod.delivered_palace
    if (gap !== 0) {
      parts.push(`chain: del=${prod.delivered_palace} sold=${prod.sold_palace} ret=${prod.returned_palace} inv=${prod.inventory_palace}`)
    } else {
      parts.push(`chain: balanced (del=${prod.delivered_palace} sold=${prod.sold_palace} ret=${prod.returned_palace} inv=${prod.inventory_palace})`)
    }

    const line = `R${row.rowNum} [${row.kind}] ${row.product_name.slice(0, 40)} | ${parts.join(' | ')}`
    if (parts.some((p) => p.includes('no intake') || p.includes('not found'))) issues.push(line)
    else ok.push(line)
  }

  console.log('\n=== ROWS THAT MATCH ADMIN INTENT (can apply) ===')
  ok.forEach((l) => console.log(l))

  console.log('\n=== ROWS NEEDING CLARIFICATION ===')
  issues.forEach((l) => console.log(l))

  // Duplicate product rows in admin file
  const dupNames = adminRows.reduce((acc, r) => {
    const k = r.product_name.toLowerCase()
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const dups = Object.entries(dupNames).filter(([, c]) => c > 1)
  if (dups.length) {
    console.log('\n=== DUPLICATE PRODUCT ROWS IN ADMIN FILE ===')
    dups.forEach(([n, c]) => console.log(`${c}x ${n}`))
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
