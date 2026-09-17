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
import { parseAdminTextDate } from '@/lib/migration/admin-date-parse'

export const SYSTEM_CORRECT_FILE = resolve(
  process.cwd(),
  'discrepancies fix/SYSTEM CORRECT FARMER TORKS 2.xlsx'
)
export const SYSTEM_CORRECT_FILE_4 = resolve(
  process.cwd(),
  'discrepancies fix/SYSTEM CORRECT FARMER TORKS 4.xlsx'
)
export const SYSTEM_CORRECT_REF = 'admin-correction:system-correct-farmer-torks-2'
export const SYSTEM_CORRECT_REF_4 = 'admin-correction:system-correct-farmer-torks-4'

export function systemCorrectRefForPath(filePath: string): string {
  if (/FARMER TORKS 4/i.test(filePath)) return SYSTEM_CORRECT_REF_4
  if (/FARMER TORKS 2/i.test(filePath)) return SYSTEM_CORRECT_REF
  return 'admin-correction:system-correct-workbook'
}

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
  /** Spintex delivery total (batch 4+ DELEVERED column). */
  delivered_target: string
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
      /** When set, only the first N matching intakes are updated (admin "one of two" rows). */
      limitMatches?: number
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

function workbookHasDeliveredColumn(ws: ExcelJS.Worksheet): boolean {
  const h = cellVal(ws.getRow(1).getCell(6).value).toLowerCase()
  return h.includes('delever') || h.includes('deliver')
}

export async function loadSystemCorrectRows(filePath = SYSTEM_CORRECT_FILE): Promise<SystemCorrectRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  const withDeliveredCol = workbookHasDeliveredColumn(ws)
  const rows: SystemCorrectRow[] = []

  for (let r = 2; r <= (ws.rowCount || 0); r++) {
    const get = (col: number) => cellVal(ws.getRow(r).getCell(col).value)
    const vendor_name = get(1)
    const product_name = get(2)
    if (!vendor_name && !product_name) continue

    if (withDeliveredCol) {
      rows.push({
        rowNum: r,
        vendor_name,
        product_name,
        current_date: get(3),
        quantity: get(4),
        action: get(5),
        delivered_target: get(6),
        replace_date: get(7),
        not_in_system_date: get(8),
        reference: get(9),
        receiving_qty: get(10),
        current_qty: get(11),
        replace_qty: get(12),
        notes: get(13),
        barcode: get(14),
      })
    } else {
      rows.push({
        rowNum: r,
        vendor_name,
        product_name,
        current_date: get(3),
        quantity: get(4),
        action: get(5),
        delivered_target: '',
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

/** Parse one spreadsheet row into zero or more actions (no DB). */
export function parseSystemCorrectRowActions(
  row: SystemCorrectRow,
  product: ResolvedProduct
): SystemCorrectAction[] {
  const out: SystemCorrectAction[] = []
  const actionRaw = row.action.trim()
  const actionUpper = actionRaw.toUpperCase()
  const fromDate = normalizeAdminDate(row.current_date)
  const toDate = normalizeAdminDate(row.replace_date)
  const newIntakeDate = normalizeAdminDate(row.not_in_system_date)
  const colQty = positiveInt(row.quantity)
  const recvQty = positiveInt(row.receiving_qty) ?? colQty
  const fromQtyCol = positiveInt(row.current_qty)
  const toQtyCol = positiveInt(row.replace_qty)
  const deliveredTarget = positiveInt(row.delivered_target)

  const push = (a: SystemCorrectAction) => out.push(a)

  if (actionUpper === 'DELETE') {
    if (fromDate) {
      push({
        kind: 'delete',
        sourceRows: [row.rowNum],
        product,
        onDate: fromDate,
        matchQty: colQty,
      })
    }
    return out
  }

  const deliveredInAction = actionRaw.match(/delivered\s+(\d+)/i)
  if (deliveredInAction) {
    push({
      kind: 'delivery_target',
      sourceRows: [row.rowNum],
      product,
      deliveredTotal: Number(deliveredInAction[1]),
      notes: row.notes,
    })
    return out
  }

  if (deliveredTarget && !actionRaw) {
    push({
      kind: 'delivery_target',
      sourceRows: [row.rowNum],
      product,
      deliveredTotal: deliveredTarget,
      notes: row.notes || `delivered=${deliveredTarget}`,
    })
    return out
  }

  const addMake = actionRaw.match(/add\s+(\d+)\s+to\s+make\s+(\d+)/i)
  if (addMake && fromDate) {
    const toQ = Number(addMake[2])
    const fromQ = colQty ?? toQ - Number(addMake[1])
    if (fromQ > 0 && toQ > 0 && fromQ !== toQ) {
      push({
        kind: 'update_qty',
        sourceRows: [row.rowNum],
        product,
        fromQty: fromQ,
        toQty: toQ,
        onDate: fromDate,
      })
    }
    return out
  }

  const changeTo = actionRaw.match(/change\s+to\s+(\d+)/i)
  const phraseDate = parseAdminTextDate(actionRaw) ?? parseAdminTextDate(row.replace_date)
  if (changeTo) {
    const toQ = Number(changeTo[1])
    const fromQ = colQty ?? fromQtyCol
    if (phraseDate && fromDate) {
      push({
        kind: 'update_date',
        sourceRows: [row.rowNum],
        product,
        fromDate,
        toDate: phraseDate,
        matchQty: fromQ ?? colQty,
        toQty: toQ,
      })
    } else if (fromQ != null && fromQ !== toQ) {
      push({
        kind: 'update_qty',
        sourceRows: [row.rowNum],
        product,
        fromQty: fromQ,
        toQty: toQ,
        onDate: fromDate ?? undefined,
      })
    }
    return out
  }

  if (/date\s+should\s+be/i.test(actionRaw) && phraseDate && fromDate) {
    push({
      kind: 'update_date',
      sourceRows: [row.rowNum],
      product,
      fromDate,
      toDate: phraseDate,
      matchQty: colQty,
      limitMatches: /one\s+date|2\s+in\s+system/i.test(actionRaw) ? 1 : undefined,
    })
    return out
  }

  if (newIntakeDate && recvQty) {
    push({
      kind: 'insert',
      sourceRows: [row.rowNum],
      product,
      qty: recvQty,
      receivedDate: newIntakeDate,
    })
    return out
  }

  if (fromDate && toDate && fromDate !== toDate) {
    push({
      kind: 'update_date',
      sourceRows: [row.rowNum],
      product,
      fromDate,
      toDate,
      matchQty: colQty,
      toQty: toQtyCol && fromQtyCol ? toQtyCol : undefined,
    })
    return out
  }

  if (fromQtyCol && toQtyCol && fromQtyCol !== toQtyCol) {
    push({
      kind: 'update_qty',
      sourceRows: [row.rowNum],
      product,
      fromQty: fromQtyCol,
      toQty: toQtyCol,
      onDate: fromDate ?? undefined,
    })
  }

  return out
}

const ACTION_KIND_ORDER: Record<SystemCorrectAction['kind'], number> = {
  delete: 0,
  update_date: 1,
  update_qty: 2,
  insert: 3,
  delivery_target: 4,
}

export function sortSystemCorrectActions(actions: SystemCorrectAction[]): SystemCorrectAction[] {
  return [...actions].sort(
    (a, b) =>
      ACTION_KIND_ORDER[a.kind] - ACTION_KIND_ORDER[b.kind] ||
      Math.min(...a.sourceRows) - Math.min(...b.sourceRows)
  )
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

    const parsed = parseSystemCorrectRowActions(row, product)
    if (!parsed.length) {
      if (row.action.trim().toUpperCase() === 'DELETE' && !normalizeAdminDate(row.current_date)) {
        skipped.push(`R${row.rowNum} DELETE without current date`)
      } else {
        skipped.push(`R${row.rowNum} ${row.product_name}: no actionable fields parsed`)
      }
      continue
    }
    actions.push(...parsed)
  }

  return { actions: sortSystemCorrectActions(actions), unresolved, skipped }
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
