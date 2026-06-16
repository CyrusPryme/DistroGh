import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns'

// ─── Currency (always "GHS" — avoids ₵ encoding issues on Windows/editors) ───

export const CURRENCY_CODE = 'GHS'

const ghsAmountFormatter = new Intl.NumberFormat('en-GH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** e.g. GHS 1,234.56 */
export function formatGHS(amount: number): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${CURRENCY_CODE} 0.00`
  return `${CURRENCY_CODE} ${ghsAmountFormatter.format(n)}`
}

/** Compact axis labels for charts, e.g. GHS 12k */
export function formatGHSChartAxis(value: number): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return `${CURRENCY_CODE} 0`
  if (Math.abs(n) >= 1_000_000) return `${CURRENCY_CODE} ${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1000) return `${CURRENCY_CODE} ${(n / 1000).toFixed(0)}k`
  return `${CURRENCY_CODE} ${n.toFixed(0)}`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-GH').format(n)
}

export function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy')
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy, HH:mm')
  } catch {
    return dateStr
  }
}

/** Normalize Date / ISO / pg values to YYYY-MM-DD for SQL date columns. */
export function toSqlDate(value: string | Date | null | undefined): string {
  if (value == null || value === '') {
    return format(new Date(), 'yyyy-MM-dd')
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return format(new Date(), 'yyyy-MM-dd')
    return format(value, 'yyyy-MM-dd')
  }
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10)
  try {
    const parsed = new Date(s)
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear()
      const m = String(parsed.getUTCMonth() + 1).padStart(2, '0')
      const d = String(parsed.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  } catch {
    /* fall through */
  }
  try {
    return format(parseISO(s), 'yyyy-MM-dd')
  } catch {
    return s
  }
}

export function getWeekRange(date: Date = new Date()) {
  const start = startOfWeek(date, { weekStartsOn: 1 }) // Monday
  const end = endOfWeek(date, { weekStartsOn: 1 })     // Sunday
  return {
    week_start: format(start, 'yyyy-MM-dd'),
    week_end: format(end, 'yyyy-MM-dd'),
  }
}

/** Default report month for imports — previous calendar month. */
export function getDefaultReportMonth(date: Date = new Date()): string {
  return format(subMonths(date, 1), 'yyyy-MM')
}

/** Convert YYYY-MM to inclusive period bounds stored on sales rows. */
export function reportMonthToRange(monthValue: string): { week_start: string; week_end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue.trim())
  if (!match) {
    return reportMonthToRange(getDefaultReportMonth())
  }
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) {
    return reportMonthToRange(getDefaultReportMonth())
  }
  const start = startOfMonth(new Date(year, month - 1, 1))
  const end = endOfMonth(start)
  return {
    week_start: format(start, 'yyyy-MM-dd'),
    week_end: format(end, 'yyyy-MM-dd'),
  }
}

export function weekStartToReportMonth(weekStart: string): string {
  try {
    return format(parseISO(weekStart), 'yyyy-MM')
  } catch {
    return getDefaultReportMonth()
  }
}

export function formatReportMonth(monthValue: string): string {
  try {
    const { week_start } = reportMonthToRange(monthValue)
    return format(parseISO(week_start), 'MMMM yyyy')
  } catch {
    return monthValue
  }
}

/** YYYY-MM key for grouping sales into calendar months. */
export function salesPeriodMonthKey(weekStart: string): string {
  return weekStartToReportMonth(weekStart)
}

/** Normalize any sale period to full calendar month bounds (stored in week_start / week_end columns). */
export function normalizeSaleMonthPeriod(weekStart: string): { week_start: string; week_end: string } {
  return reportMonthToRange(salesPeriodMonthKey(weekStart))
}

/** Display label for a sale period — shows month name when bounds are a full calendar month. */
export function formatSalesPeriod(weekStart: string, weekEnd?: string): string {
  try {
    const start = parseISO(weekStart)
    const end = weekEnd ? parseISO(weekEnd) : start
    const monthStart = startOfMonth(start)
    const monthEnd = endOfMonth(start)
    if (
      format(start, 'yyyy-MM-dd') === format(monthStart, 'yyyy-MM-dd') &&
      format(end, 'yyyy-MM-dd') === format(monthEnd, 'yyyy-MM-dd')
    ) {
      return format(start, 'MMMM yyyy')
    }
    return formatWeekRange(weekStart, weekEnd ?? weekStart)
  } catch {
    return weekStart
  }
}

export function formatWeekRange(start: string, end: string): string {
  try {
    return `${format(parseISO(start), 'dd MMM')} – ${format(parseISO(end), 'dd MMM yyyy')}`
  } catch {
    return `${start} – ${end}`
  }
}

// ─── MoMo Networks ────────────────────────────────────────────────────────────

export const MOMO_NETWORK_COLORS = {
  MTN: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200' },
  Vodafone: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' },
  AirtelTigo: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
}

// ─── Status Badges ────────────────────────────────────────────────────────────

export const PAYOUT_STATUS_STYLES = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Pending' },
  partial: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', label: 'Partially paid' },
  processing: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Processing' },
  completed: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', label: 'Fully paid' },
  failed: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Failed' },
}

// ─── Class merging helper ─────────────────────────────────────────────────────

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len) + '…'
}

export function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}
