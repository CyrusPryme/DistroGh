/**
 * Palace / historical sales spreadsheet column normalization.
 * Maps legacy export headers (store_name, MONTH, PAID, PAYMENT TO SUPPLIER, …) to canonical
 * migration fields used by validate.ts and writers.ts.
 */

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

/** True when PAID cell indicates vendor was paid (any non-blank value = paid per Palace convention). */
export function isPaidMarker(raw: unknown): boolean {
  return str(raw) !== ''
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
  out.vendor_paid = isPaidMarker(paidRaw)

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

  return out
}
