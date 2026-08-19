/**
 * Palace / historical sales spreadsheet column normalization.
 * Maps legacy export headers (store_name, MONTH, PAID, PAYMENT TO SUPPLIER, …) to canonical
 * migration fields used by validate.ts and writers.ts.
 *
 * Historical sale amounts are derived only from qty + TCostEx (per-unit = TCostEx ÷ qty).
 * Spreadsheet unit_price / shop totals are ignored. Vendor comes from the matched product,
 * not from a template column (Palace vendor/NAME columns in uploads are informational only).
 */

import { roundMoney } from '@/lib/utils'

export type HistoricalSaleAmounts = {
  qty: number
  vendor_due: number
  unit_price: number
  total_sales: number
  commission_amount: number
}

const MONTH_BY_NAME: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

function str(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result
    if (r != null && typeof r !== 'object') return String(r).trim()
  }
  return String(v).trim()
}

function num(v: unknown): number | null {
  const s = str(v)
  if (!s) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function normKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/** Read first matching field from a row (handles Palace header casing/spacing). */
export function pickSalesField(data: Record<string, unknown>, ...aliases: string[]): unknown {
  const byNorm = new Map<string, unknown>()
  for (const [k, v] of Object.entries(data)) {
    byNorm.set(normKey(k), v)
  }
  for (const alias of aliases) {
    const hit = byNorm.get(normKey(alias))
    if (hit != null && str(hit) !== '') return hit
  }
  return undefined
}

/** Parse "JUNE", "Jun", etc. to 1–12; returns null if unknown. */
export function parseMonthName(raw: unknown): number | null {
  const key = str(raw).toLowerCase().replace(/\./g, '')
  return MONTH_BY_NAME[key] ?? null
}

/** Build YYYY-MM-01 from MONTH text + year, or return null. */
export function monthTextToReportMonth(monthRaw: unknown, yearRaw: unknown): string | null {
  const monthNum = parseMonthName(monthRaw)
  const year = num(yearRaw)
  if (!monthNum || year == null || year < 1900 || year > 2100) return null
  return `${year}-${String(monthNum).padStart(2, '0')}-01`
}

/** True when PAID cell = supermarket has remitted to DistroGH for this sale line (non-blank). */
export function isSupermarketPaidMarker(raw: unknown): boolean {
  return str(raw) !== ''
}

/** @deprecated Use isSupermarketPaidMarker — PAID is supermarket→DistroGH, not vendor payout. */
export function isPaidMarker(raw: unknown): boolean {
  return isSupermarketPaidMarker(raw)
}

export function rowHasPaidColumn(data: Record<string, unknown>): boolean {
  return Object.keys(data).some((k) => normKey(k) === 'paid')
}

/** Normalize Palace / generic sales row headers into canonical migration fields. */
export function normalizeSalesRowData(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data }

  const description = pickSalesField(data, 'description', 'product', 'product_name')
  if (description != null && !out.description) out.description = description

  const code = pickSalesField(data, 'code', 'barcode', 'Code')
  if (code != null && !out.code) out.code = code

  const qty = pickSalesField(data, 'qty', 'quantity', 'Qty')
  if (qty != null && out.qty == null && out.quantity == null) out.qty = qty

  const storeName = pickSalesField(data, 'store_name', 'branch', 'BRANCH')
  if (storeName != null) {
    if (!out.store_name) out.store_name = storeName
    if (!out.branch) out.branch = storeName
  }

  const store = pickSalesField(data, 'store', 'store_code')
  if (store != null && !out.store) out.store = store

  const tcost = pickSalesField(
    data,
    'TCostEx',
    'tcostex',
    'PAYMENT TO SUPPLIER',
    'payment to supplier',
    'total cost',
    'TOTAL COST'
  )
  if (tcost != null) {
    if (out.TCostEx == null) out.TCostEx = tcost
    if (out.vendor_due == null) {
      const n = num(tcost)
      if (n != null) out.vendor_due = n
    }
  }

  const vendor = pickSalesField(data, 'vendor', 'vendor_name', 'NAME', 'name', 'creditor')
  if (vendor != null && !out.vendor && !out.vendor_name) out.vendor = vendor

  const paidRaw = pickSalesField(data, 'paid', 'PAID')
  if (paidRaw != null && out.paid == null) out.paid = paidRaw
  // Only set when the source file includes PAID — absent column → leave unset (import defaults false).
  if (rowHasPaidColumn(data)) {
    out.supermarket_paid = isSupermarketPaidMarker(paidRaw)
  }

  const settlementRaw = pickSalesField(data, 'supermarket_paid')
  if (settlementRaw != null && typeof out.supermarket_paid !== 'boolean') {
    const token = str(settlementRaw).toLowerCase()
    if (token === 'yes' || token === 'true' || token === '1') out.supermarket_paid = true
    else if (token === 'no' || token === 'false' || token === '0') out.supermarket_paid = false
  }

  if (!str(out.report_month) && !str(out.week_start)) {
    const monthText = pickSalesField(data, 'month', 'MONTH', 'report_month')
    const year = pickSalesField(data, 'report_year', 'year')
    const fromText = monthTextToReportMonth(monthText, year)
    if (fromText) {
      out.report_month = fromText
    } else if (monthText && /^\d{4}-\d{2}/.test(str(monthText))) {
      out.report_month = str(monthText)
    }
  }

  const amounts = resolveHistoricalSaleAmounts(out)
  if (amounts) {
    out.vendor_due = amounts.vendor_due
    out.unit_price = amounts.unit_price
    out.total_sales = amounts.total_sales
    out.commission_amount = amounts.commission_amount
  }

  return out
}

/**
 * Derive sale money fields from qty + TCostEx only (price at time of recording = TCostEx ÷ qty).
 * Ignores spreadsheet unit_price / total_sales and never reads the live product catalog.
 */
export function resolveHistoricalSaleAmounts(data: Record<string, unknown>): HistoricalSaleAmounts | null {
  const qty = num(data.qty ?? data.quantity)
  if (qty == null || qty <= 0) return null

  const vendorDueRaw = num(data.vendor_due ?? data.TCostEx ?? data.tcostex)
  if (vendorDueRaw == null || vendorDueRaw < 0) return null

  const vendorDue = roundMoney(vendorDueRaw)
  const unit = roundMoney(vendorDue / qty)
  const total = roundMoney(unit * qty)

  return {
    qty,
    vendor_due: vendorDue,
    unit_price: unit,
    total_sales: total,
    commission_amount: 0,
  }
}
