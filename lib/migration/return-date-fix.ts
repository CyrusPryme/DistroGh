/**
 * Infer corrected return_date when return precedes earliest delivery.
 * Uses sibling returns, year-typo heuristic, then median delivery→return lag.
 */
import { migrationStr } from '@/lib/migration/fix-workbook'
import { toSqlDate } from '@/lib/utils'

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00.000Z`)
  const b = new Date(`${toIso}T00:00:00.000Z`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return toSqlDate(d.toISOString())
}

export function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/** Earliest delivery_date per barcode from delivery migration rows. */
export function buildEarliestDeliveryByBarcode(
  deliveryRows: Record<string, unknown>[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const row of deliveryRows) {
    const bc = migrationStr(row.barcode)
    const d = toSqlDate(migrationStr(row.delivery_date))
    if (!bc || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    const prev = out.get(bc)
    if (!prev || d < prev) out.set(bc, d)
  }
  return out
}

export interface ReturnDeliveryLagStats {
  medianLagDays: number
  /** Valid return dates already in the returns file, grouped by barcode. */
  validReturnDatesByBarcode: Map<string, string[]>
}

/** Median days from earliest delivery to return for rows that already pass chronology. */
export function computeReturnDeliveryLagStats(
  returnRows: Record<string, unknown>[],
  earliestDeliveryByBarcode: Map<string, string>
): ReturnDeliveryLagStats {
  const lags: number[] = []
  const validReturnDatesByBarcode = new Map<string, string[]>()

  for (const row of returnRows) {
    const bc = migrationStr(row.barcode)
    const ret = toSqlDate(migrationStr(row.return_date))
    const earliest = earliestDeliveryByBarcode.get(bc)
    if (!bc || !earliest || !/^\d{4}-\d{2}-\d{2}$/.test(ret)) continue
    if (ret >= earliest) {
      lags.push(daysBetween(earliest, ret))
      const list = validReturnDatesByBarcode.get(bc) ?? []
      list.push(ret)
      validReturnDatesByBarcode.set(bc, list)
    }
  }

  const medianLagDays = median(lags) || 210
  return { medianLagDays, validReturnDatesByBarcode }
}

export interface ReturnDateFixResult {
  returnDate: string
  adjusted: boolean
  detail: string
}

/**
 * Fix return_date when it precedes earliest delivery for the product.
 *
 * Priority:
 * 1. Match another valid return row for the same barcode (same product batch pattern)
 * 2. Year typo: add 365 days if that clears chronology (common spreadsheet mistake)
 * 3. earliest delivery + median lag from other valid returns in the file
 * 4. earliest delivery + 30 days (minimum shelf-time fallback)
 */
export function fixReturnDateBeforeDelivery(
  returnDateIso: string,
  earliestDeliveryIso: string,
  validSiblingReturns: string[],
  medianLagDays: number
): ReturnDateFixResult {
  if (returnDateIso >= earliestDeliveryIso) {
    return { returnDate: returnDateIso, adjusted: false, detail: '' }
  }

  if (validSiblingReturns.length) {
    const pick = [...validSiblingReturns].sort()[0]!
    return {
      returnDate: pick,
      adjusted: true,
      detail: `return ${returnDateIso} → ${pick} (matched other return row for this product after delivery ${earliestDeliveryIso})`,
    }
  }

  const yearFix = addDays(returnDateIso, 365)
  if (yearFix >= earliestDeliveryIso) {
    return {
      returnDate: yearFix,
      adjusted: true,
      detail: `return ${returnDateIso} → ${yearFix} (year typo — shifted +365d to clear delivery ${earliestDeliveryIso})`,
    }
  }

  const medianFix = addDays(earliestDeliveryIso, medianLagDays)
  return {
    returnDate: medianFix,
    adjusted: true,
    detail: `return ${returnDateIso} → ${medianFix} (delivery ${earliestDeliveryIso} + median ${medianLagDays}d lag from other returns)`,
  }
}
