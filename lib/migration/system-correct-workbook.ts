/**
 * Parse "SYSTEM CORRECT *.xlsx" admin correction workbooks (Farmer Torks batch format).
 */
import ExcelJS from 'exceljs'
import type { Pool, PoolClient } from 'pg'
import { resolve } from 'node:path'
import {
  normalizeAdminDate,
  resolveProductByName,
  type ResolvedProduct,
} from '@/lib/migration/admin-intake-corrections'

export const SYSTEM_CORRECT_FILE = resolve(
  process.cwd(),
  'discrepancies fix/SYSTEM CORRECT FARMER TORKS 2.xlsx'
)
export const SYSTEM_CORRECT_REF = 'admin-correction:system-correct-farmer-torks-2'

export type SystemCorrectRow = {
  rowNum: number
  vendor_name: string
  product_name: string
  current_date: string
  quantity: string
  action: string
  replace_date: string
  not_in_system_date: string
  reference: string
  receiving_qty: string
  current_qty: string
  replace_qty: string
  notes: string
  barcode: string
}

export type DeleteIntakeAction = {
  kind: 'delete'
  sourceRows: number[]
  product: ResolvedProduct
  onDate: string
  matchQty?: number
}

export type SystemCorrectAction =
  | DeleteIntakeAction
  | {
      kind: 'update_date'
      sourceRows: number[]
      product: ResolvedProduct
      fromDate: string
      toDate: string
      matchQty?: number
      toQty?: number
    }
  | {
      kind: 'update_qty'
      sourceRows: number[]
      product: ResolvedProduct
      fromQty: number
      toQty: number
      onDate?: string
    }
  | {
      kind: 'insert'
      sourceRows: number[]
      product: ResolvedProduct
      qty: number
      receivedDate: string
    }
  | {
      kind: 'delivery_target'
      sourceRows: number[]
      product: ResolvedProduct
      deliveredTotal: number
      notes: string
    }

function cellVal(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return String((v as { result?: unknown }).result ?? '').trim()
  }
  return String(v).trim()
}

export async function loadSystemCorrectRows(filePath = SYSTEM_CORRECT_FILE): Promise<SystemCorrectRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  const rows: SystemCorrectRow[] = []

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
      quantity: get(4),
      action: get(5),
      replace_date: get(6),
      not_in_system_date: get(7),
      reference: get(8),
      receiving_qty: get(9),
      current_qty: get(10),
      replace_qty: get(11),
      notes: get(12),
      barcode: get(13),
    })
  }
  return rows
}

async function resolveProduct(
  pool: Pool | PoolClient,
  row: SystemCorrectRow
): Promise<ResolvedProduct | null> {
  if (row.barcode?.trim()) {
    const { rows } = await pool.query<ResolvedProduct>(
      `SELECT p.id AS product_id, p.name AS product_name, p.barcode,
              v.id AS vendor_id, v.name AS vendor_name
       FROM products p
       JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.barcode = $1
       LIMIT 1`,
      [row.barcode.trim()]
    )
    if (rows[0]) return rows[0]
  }
  return resolveProductByName(pool, row.vendor_name, row.product_name)
}

function positiveInt(s: string): number | undefined {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

export async function buildSystemCorrectPlan(
  pool: Pool | PoolClient,
  rows: SystemCorrectRow[]
): Promise<{ actions: SystemCorrectAction[]; unresolved: string[]; skipped: string[] }> {
  const unresolved: string[] = []
  const skipped: string[] = []
  const actions: SystemCorrectAction[] = []

  for (const row of rows) {
    const product = await resolveProduct(pool, row)
    if (!product) {
      unresolved.push(`R${row.rowNum} ${row.product_name}: product not found`)
      continue
    }

    const actionUpper = row.action.trim().toUpperCase()
    const fromDate = normalizeAdminDate(row.current_date)
    const toDate = normalizeAdminDate(row.replace_date)
    const newIntakeDate = normalizeAdminDate(row.not_in_system_date)
    const colQty = positiveInt(row.quantity)
    const recvQty = positiveInt(row.receiving_qty) ?? colQty
    const fromQty = positiveInt(row.current_qty)
    const toQty = positiveInt(row.replace_qty)

    if (actionUpper === 'DELETE') {
      if (!fromDate) {
        skipped.push(`R${row.rowNum} DELETE without current date`)
        continue
      }
      actions.push({
        kind: 'delete',
        sourceRows: [row.rowNum],
        product,
        onDate: fromDate,
        matchQty: colQty,
      })
      continue
    }

    const deliveredMatch = row.action.match(/delivered\s+(\d+)/i)
    if (deliveredMatch) {
      actions.push({
        kind: 'delivery_target',
        sourceRows: [row.rowNum],
        product,
        deliveredTotal: Number(deliveredMatch[1]),
        notes: row.notes,
      })
      continue
    }

    if (newIntakeDate && recvQty) {
      actions.push({
        kind: 'insert',
        sourceRows: [row.rowNum],
        product,
        qty: recvQty,
        receivedDate: newIntakeDate,
      })
      continue
    }

    if (fromDate && toDate && fromDate !== toDate) {
      actions.push({
        kind: 'update_date',
        sourceRows: [row.rowNum],
        product,
        fromDate,
        toDate,
        matchQty: colQty,
        toQty: toQty && fromQty ? toQty : undefined,
      })
      continue
    }

    if (fromQty && toQty && fromQty !== toQty) {
      actions.push({
        kind: 'update_qty',
        sourceRows: [row.rowNum],
        product,
        fromQty,
        toQty,
        onDate: fromDate ?? undefined,
      })
      continue
    }

    skipped.push(`R${row.rowNum} ${row.product_name}: no actionable fields parsed`)
  }

  return { actions, unresolved, skipped }
}

export type IntakeMatch = {
  id: string
  received_date: string
  quantity_received: number
}

export async function findIntakesForDelete(
  client: PoolClient,
  action: DeleteIntakeAction
): Promise<IntakeMatch[]> {
  const params: unknown[] = [action.product.product_id, action.onDate]
  let sql = `SELECT id, received_date::text, quantity_received
             FROM intakes
             WHERE deleted_at IS NULL AND product_id = $1::uuid AND received_date = $2::date`
  if (action.matchQty != null) {
    params.push(action.matchQty)
    sql += ` AND quantity_received = $3`
  }
  sql += ` ORDER BY created_at`
  const { rows } = await client.query<IntakeMatch>(sql, params)
  return rows
}
