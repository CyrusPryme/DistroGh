/**
 * Plan admin delivery corrections from CORRECTING DELIVERIES *.xlsx workbooks
 * (same column layout as system-correct / chronology admin sheets).
 */
import type { Pool, PoolClient } from 'pg'
import { normalizeAdminDate, resolveProductByName, type ResolvedProduct } from '@/lib/migration/admin-intake-corrections'
import {
  loadSystemCorrectRows,
  type SystemCorrectRow,
} from '@/lib/migration/system-correct-workbook'
import { spintexDeliveryGapQty } from '@/lib/migration/discrepancy-auto-fix'
import type { StockChainProductRow } from '@/lib/migration/stock-chain-data'

export const CORRECTING_DELIVERIES_3_FILE = 'discrepancies fix/CORRECTING DELIVERIES 3.xlsx'
export const CORRECTING_DELIVERIES_3_REF = 'admin-correction:correcting-deliveries-3'

export type DeliveryDateFixAction = {
  kind: 'update_delivery_date'
  sourceRows: number[]
  product: ResolvedProduct
  fromDate: string
  toDate: string
  matchQty: number
}

export type DeliveryInsertAction = {
  kind: 'insert_delivery'
  sourceRows: number[]
  product: ResolvedProduct
  deliveryDate: string
  qty: number
}

export type DeliveryCorrectionAction =
  | DeliveryDateFixAction
  | DeliveryInsertAction

/** When several runs share qty, prefer wrong admin/migration dates, then earliest. */
export function pickRunForAuthoritativeDate(
  candidates: DeliveryRunMatch[],
  targetDate: string
): DeliveryRunMatch | null {
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]!

  const notTarget = candidates.filter((r) => r.delivery_date.slice(0, 10) !== targetDate)
  if (notTarget.length === 1) return notTarget[0]!

  const pool = notTarget.length ? notTarget : candidates
  const typoDates = new Set(['2026-05-13', '2025-12-13', '2025-06-01', '2025-07-02', '2025-09-01'])
  const typo = pool.filter((r) => typoDates.has(r.delivery_date.slice(0, 10)))
  if (typo.length === 1) return typo[0]!

  return [...pool].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))[0]!
}

function positiveInt(s: string): number | undefined {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

function collapseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function listVendorNameCandidates(
  pool: Pool | PoolClient,
  vendorName: string,
  productNameNorm: string
): Promise<ResolvedProduct[]> {
  const { rows } = await pool.query<ResolvedProduct>(
    `SELECT p.id AS product_id, p.name AS product_name, p.barcode,
            v.id AS vendor_id, v.name AS vendor_name
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id AND v.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) = $1
       AND (
         lower(regexp_replace(trim(v.name), '\\s+', ' ', 'g'))
           = lower(regexp_replace(trim($2), '\\s+', ' ', 'g'))
         OR lower(regexp_replace(trim(v.name), '\\s+', ' ', 'g'))
           LIKE lower(regexp_replace(trim($2), '\\s+', ' ', 'g')) || '%'
         OR lower(regexp_replace(trim($2), '\\s+', ' ', 'g'))
           LIKE lower(regexp_replace(trim(v.name), '\\s+', ' ', 'g')) || '%'
       )
     ORDER BY length(p.name) DESC`,
    [productNameNorm, vendorName]
  )
  return rows
}

async function resolveProduct(pool: Pool | PoolClient, row: SystemCorrectRow): Promise<ResolvedProduct | null> {
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

  const nameNorm = collapseName(row.product_name)
  const candidates = await listVendorNameCandidates(pool, row.vendor_name, nameNorm)
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length > 1) {
    const fromDate = normalizeAdminDate(row.current_date)
    const qty = positiveInt(row.quantity)
    if (fromDate && qty) {
      for (const c of candidates) {
        const { rows: hit } = await pool.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
           FROM delivery_run_items dri
           JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
           WHERE dri.product_id = $1::uuid AND dr.delivery_date = $2::date
             AND dri.quantity_delivered = $3`,
          [c.product_id, fromDate, qty]
        )
        if ((hit[0]?.n ?? 0) > 0) return c
      }
    }
    return candidates[0]!
  }

  return resolveProductByName(pool, row.vendor_name, row.product_name)
}

export async function buildDeliveryCorrectionPlan(
  pool: Pool | PoolClient,
  rows: SystemCorrectRow[]
): Promise<{ actions: DeliveryCorrectionAction[]; unresolved: string[]; skipped: string[] }> {
  const unresolved: string[] = []
  const skipped: string[] = []
  const actions: DeliveryCorrectionAction[] = []

  for (const row of rows) {
    const product = await resolveProduct(pool, row)
    if (!product) {
      unresolved.push(`R${row.rowNum} ${row.product_name}: product not found`)
      continue
    }

    const fromDate = normalizeAdminDate(row.current_date)
    const toDate = normalizeAdminDate(row.replace_date)
    const missingDate = normalizeAdminDate(row.not_in_system_date)
    const qty = positiveInt(row.quantity)
    if (!qty) {
      skipped.push(`R${row.rowNum} ${row.product_name}: missing quantity`)
      continue
    }

    if (fromDate && toDate && fromDate !== toDate) {
      actions.push({
        kind: 'update_delivery_date',
        sourceRows: [row.rowNum],
        product,
        fromDate,
        toDate,
        matchQty: qty,
      })
      continue
    }

    if (missingDate && !fromDate) {
      actions.push({
        kind: 'insert_delivery',
        sourceRows: [row.rowNum],
        product,
        deliveryDate: missingDate,
        qty,
      })
      continue
    }

    if (missingDate && fromDate && !toDate) {
      skipped.push(`R${row.rowNum} ${row.product_name}: has current date + NOT IN SYSTEM but no replace date`)
      continue
    }

    if (toDate && fromDate && fromDate === toDate) {
      skipped.push(`R${row.rowNum} ${row.product_name}: from/to dates identical`)
      continue
    }

    skipped.push(`R${row.rowNum} ${row.product_name}: no delivery action parsed`)
  }

  return { actions, unresolved, skipped }
}

export type DeliveryRunMatch = {
  delivery_run_id: string
  delivery_date: string
  quantity_delivered: number
}

export async function findSpintexDeliveryRuns(
  client: PoolClient,
  productId: string,
  spintexId: string,
  opts: { onDate?: string; qty?: number }
): Promise<DeliveryRunMatch[]> {
  const params: unknown[] = [productId, spintexId]
  let sql = `
    SELECT dr.id AS delivery_run_id, dr.delivery_date::text AS delivery_date,
           dri.quantity_delivered::int AS quantity_delivered
    FROM delivery_run_items dri
    JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
    WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid`
  if (opts.onDate) {
    params.push(opts.onDate)
    sql += ` AND dr.delivery_date = $${params.length}::date`
  }
  if (opts.qty != null) {
    params.push(opts.qty)
    sql += ` AND dri.quantity_delivered = $${params.length}`
  }
  sql += ` ORDER BY dr.delivery_date, dr.created_at`
  const { rows } = await client.query<DeliveryRunMatch>(sql, params)
  return rows
}

/** Block inserts that would over-deliver vs warehouse receipts or duplicate an existing row. */
export function insertDeliveryAllowed(
  chain: StockChainProductRow | undefined,
  qty: number,
  existingOnDate: DeliveryRunMatch[]
): { ok: true } | { ok: false; reason: string } {
  if (existingOnDate.some((r) => r.quantity_delivered === qty)) {
    return { ok: false, reason: `delivery already exists on date×qty` }
  }
  if (!chain) return { ok: true }
  const gap = spintexDeliveryGapQty(chain)
  if (gap === 0 && chain.delivered_palace >= chain.sold_palace + chain.returned_palace) {
    return {
      ok: false,
      reason: `Spintex delivery gap is 0 (delivered=${chain.delivered_palace}) — use redate path`,
    }
  }
  if (chain.received > 0 && chain.delivered_palace + qty > chain.received) {
    return {
      ok: false,
      reason: `would exceed received (${chain.delivered_palace}+${qty} > ${chain.received})`,
    }
  }
  if (gap > 0 && qty > gap) {
    return { ok: false, reason: `qty ${qty} exceeds Spintex gap ${gap}` }
  }
  return { ok: true }
}

export { loadSystemCorrectRows }
