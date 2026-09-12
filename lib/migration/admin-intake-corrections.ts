/**
 * Parse and plan admin intake corrections from chronology fix admin.xlsx.
 */
import ExcelJS from 'exceljs'
import type { Pool, PoolClient } from 'pg'
import { resolve } from 'node:path'

export const ADMIN_INTAKE_FILE = resolve(process.cwd(), 'discrepancies fix/chronology fix admin.xlsx')
export const ADMIN_CORRECTION_REF = 'admin-correction:chronology-fix-admin'

export type AdminIntakeRow = {
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
}

export type ResolvedProduct = {
  product_id: string
  product_name: string
  barcode: string | null
  vendor_id: string
  vendor_name: string
}

export type DateFixAction = {
  kind: 'update_date'
  sourceRows: number[]
  product: ResolvedProduct
  fromDate: string
  toDate: string
  /** When set, only intakes with this quantity are updated. */
  matchQty?: number
  /** When set, also set quantity_received on matched intakes. */
  toQty?: number
}

export type QtyFixAction = {
  kind: 'update_qty'
  sourceRows: number[]
  product: ResolvedProduct
  fromQty: number
  toQty: number
  /** When set, only intakes on this date are updated. */
  onDate?: string
}

export type NewIntakeAction = {
  kind: 'insert'
  sourceRows: number[]
  product: ResolvedProduct
  qty: number
  receivedDate: string
}

export type IntakeCorrectionAction = DateFixAction | QtyFixAction | NewIntakeAction

function cellVal(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return String((v as { result?: unknown }).result ?? '').trim()
  }
  return String(v).trim()
}

export function normalizeAdminDate(s: string): string | null {
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
  const dash = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (dash) {
    const a = Number(dash[1])
    const b = Number(dash[2])
    const yyyy = dash[3]
    if (a > 12) {
      return `${yyyy}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`
    }
    if (b > 12) {
      return `${yyyy}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
    }
    return `${yyyy}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`
  }
  return t
}

/** Admin confirmed R16 current date typo: spreadsheet says 2026-12-11, production has 2025-12-11. */
function effectiveCurrentDate(row: AdminIntakeRow): string | null {
  const cur = normalizeAdminDate(row.current_date)
  if (!cur) return null
  if (row.rowNum === 16 && cur === '2026-12-11') return '2025-12-11'
  return cur
}

/** Rows where col 6 is target qty after a date move (not a new intake). */
function dateFixTargetQty(row: AdminIntakeRow): number | undefined {
  if (row.not_in_system) return undefined
  if (row.current_qty || row.corrected_qty) return undefined
  const fromDate = effectiveCurrentDate(row)
  const toDate = normalizeAdminDate(row.corrected_date)
  if (!fromDate || !toDate || fromDate === toDate) return undefined
  const q = Number(row.receiving_qty)
  return Number.isFinite(q) && q > 0 ? q : undefined
}

export async function loadAdminIntakeRows(filePath = ADMIN_INTAKE_FILE): Promise<AdminIntakeRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  const rows: AdminIntakeRow[] = []

  for (let r = 2; r <= (ws.rowCount || 0); r++) {
    const get = (col: number) => cellVal(ws.getRow(r).getCell(col).value)
    const vendor_name = get(1)
    const product_name = get(2)
    if (!vendor_name && !product_name) continue

    rows.push({
      rowNum: r,
      vendor_name,
      product_name,
      current_date: get(3),
      corrected_date: get(4),
      not_in_system: get(5),
      receiving_qty: get(6),
      current_qty: get(7),
      corrected_qty: get(8),
      notes: get(9),
      barcode: get(10),
    })
  }
  return rows
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Hard-coded admin clarifications keyed by spreadsheet row number. */
function qtyFixOnDate(row: AdminIntakeRow): string | undefined {
  // R2 PALS HONEY 365ML 24→12: admin confirmed intake is on 2nd May (2026-05-02 in production).
  if (row.rowNum === 2) return '2026-05-02'
  return undefined
}

export async function resolveProductByName(
  pool: Pool | PoolClient,
  vendorName: string,
  productName: string
): Promise<ResolvedProduct | null> {
  const nameNorm = normalizeName(productName)
  const { rows } = await pool.query<{
    product_id: string
    product_name: string
    barcode: string | null
    vendor_id: string
    vendor_name: string
  }>(
    `SELECT p.id AS product_id, p.name AS product_name, p.barcode,
            v.id AS vendor_id, v.name AS vendor_name
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND lower(trim(p.name)) = lower(trim($1))
     ORDER BY CASE WHEN lower(trim(v.name)) = lower(trim($2)) THEN 0 ELSE 1 END
     LIMIT 1`,
    [productName, vendorName]
  )
  if (rows[0]) return rows[0]

  const { rows: collapsed } = await pool.query<{
    product_id: string
    product_name: string
    barcode: string | null
    vendor_id: string
    vendor_name: string
  }>(
    `SELECT p.id AS product_id, p.name AS product_name, p.barcode,
            v.id AS vendor_id, v.name AS vendor_name
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) = $1
     ORDER BY CASE WHEN lower(trim(v.name)) = lower(trim($2)) THEN 0 ELSE 1 END
     LIMIT 1`,
    [nameNorm, vendorName]
  )
  if (collapsed[0]) return collapsed[0]

  // ADEPA typo in admin sheet — admin gave canonical name + barcode 603602777111.
  if (nameNorm.includes('adepa')) {
    const { rows: adepa } = await pool.query<{
      product_id: string
      product_name: string
      barcode: string | null
      vendor_id: string
      vendor_name: string
    }>(
      `SELECT p.id AS product_id, p.name AS product_name, p.barcode,
              v.id AS vendor_id, v.name AS vendor_name
       FROM products p
       JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.barcode = '603602777111'
       LIMIT 1`
    )
    if (adepa[0]) return adepa[0]
  }

  const { rows: fuzzy } = await pool.query<{
    product_id: string
    product_name: string
    barcode: string | null
    vendor_id: string
    vendor_name: string
  }>(
    `SELECT p.id AS product_id, p.name AS product_name, p.barcode,
            v.id AS vendor_id, v.name AS vendor_name
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND lower(p.name) LIKE '%' || lower($1) || '%'
     ORDER BY length(p.name),
              CASE WHEN lower(trim(v.name)) = lower(trim($2)) THEN 0 ELSE 1 END
     LIMIT 1`,
    [productName.slice(0, 24), vendorName]
  )
  return fuzzy[0] ?? null
}

export async function buildIntakeCorrectionPlan(
  pool: Pool | PoolClient,
  adminRows: AdminIntakeRow[]
): Promise<{ actions: IntakeCorrectionAction[]; unresolved: string[] }> {
  const unresolved: string[] = []
  const dateFixes = new Map<string, DateFixAction>()
  const qtyFixes = new Map<string, QtyFixAction>()
  const newIntakes = new Map<string, NewIntakeAction>()

  for (const row of adminRows) {
    const product = await resolveProductByName(pool, row.vendor_name, row.product_name)
    if (!product) {
      unresolved.push(`R${row.rowNum} ${row.product_name}: product not found by name`)
      continue
    }

    const newDate = normalizeAdminDate(row.not_in_system)
    const recvQty = Number(row.receiving_qty)
    if (newDate && Number.isFinite(recvQty) && recvQty > 0) {
      const key = `${product.product_id}|insert|${newDate}|${recvQty}`
      const existing = newIntakes.get(key)
      if (existing) existing.sourceRows.push(row.rowNum)
      else {
        newIntakes.set(key, {
          kind: 'insert',
          sourceRows: [row.rowNum],
          product,
          qty: recvQty,
          receivedDate: newDate,
        })
      }
      continue
    }

    const fromDate = effectiveCurrentDate(row)
    const toDate = normalizeAdminDate(row.corrected_date)
    const curQty = Number(row.current_qty)
    const fixQty = Number(row.corrected_qty)
    const hasQtyFix =
      Number.isFinite(curQty) && Number.isFinite(fixQty) && curQty > 0 && fixQty > 0 && curQty !== fixQty

    if (fromDate && toDate && fromDate !== toDate) {
      const toQty = dateFixTargetQty(row)
      const key = `${product.product_id}|date|${fromDate}|${toDate}|${toQty ?? ''}`
      const existing = dateFixes.get(key)
      if (existing) existing.sourceRows.push(row.rowNum)
      else {
        dateFixes.set(key, {
          kind: 'update_date',
          sourceRows: [row.rowNum],
          product,
          fromDate,
          toDate,
          toQty,
        })
      }
    }

    if (hasQtyFix) {
      const onDate = qtyFixOnDate(row)
      const key = `${product.product_id}|qty|${curQty}|${fixQty}|${onDate ?? ''}`
      const existing = qtyFixes.get(key)
      if (existing) existing.sourceRows.push(row.rowNum)
      else {
        qtyFixes.set(key, {
          kind: 'update_qty',
          sourceRows: [row.rowNum],
          product,
          fromQty: curQty,
          toQty: fixQty,
          onDate,
        })
      }
    }
  }

  const actions: IntakeCorrectionAction[] = [
    ...dateFixes.values(),
    ...qtyFixes.values(),
    ...newIntakes.values(),
  ]
  actions.sort((a, b) => Math.min(...a.sourceRows) - Math.min(...b.sourceRows))
  return { actions, unresolved }
}

export type IntakeMatch = {
  id: string
  received_date: string
  quantity_received: number
}

export async function findIntakesForAction(
  client: PoolClient,
  action: DateFixAction | QtyFixAction
): Promise<IntakeMatch[]> {
  if (action.kind === 'update_date') {
    const { rows } = await client.query<IntakeMatch>(
      `SELECT id, received_date::text, quantity_received
       FROM intakes
       WHERE deleted_at IS NULL AND product_id = $1::uuid
         AND received_date = $2::date
       ORDER BY received_date, quantity_received`,
      [action.product.product_id, action.fromDate]
    )
    return rows
  }

  const params: unknown[] = [action.product.product_id, action.fromQty]
  let sql = `SELECT id, received_date::text, quantity_received
             FROM intakes
             WHERE deleted_at IS NULL AND product_id = $1::uuid
               AND quantity_received = $2`
  if (action.onDate) {
    params.push(action.onDate)
    sql += ` AND received_date = $3::date`
  }
  sql += ` ORDER BY received_date, quantity_received`
  const { rows } = await client.query<IntakeMatch>(sql, params)
  return rows
}
