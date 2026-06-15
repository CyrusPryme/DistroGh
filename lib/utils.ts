import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns'

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

export function getWeekRange(date: Date = new Date()) {
  const start = startOfWeek(date, { weekStartsOn: 1 }) // Monday
  const end = endOfWeek(date, { weekStartsOn: 1 })     // Sunday
  return {
    week_start: format(start, 'yyyy-MM-dd'),
    week_end: format(end, 'yyyy-MM-dd'),
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
