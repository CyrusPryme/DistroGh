import {
  addDays,
  addYears,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
} from 'date-fns'

/** Days before expiry to show renewal reminder. */
export const SERVICE_CHARGE_REMINDER_DAYS = 30

/** Days after expiry before auto-suspension (grace period). */
export const SERVICE_CHARGE_GRACE_DAYS = 14

export type ServiceChargePaymentStatus = 'unpaid' | 'paid'

export type ServiceChargeLifecycle =
  | 'unpaid'
  | 'active'
  | 'expiring_soon'
  | 'grace_period'
  | 'overdue'

export type VendorSuspendedReason = 'manual' | 'service_charge'

export const SERVICE_CHARGE_YEAR_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const SERVICE_CHARGE_MAX_YEARS = 20

export type ServiceChargeExtendMode = 'from_payment_date' | 'extend_current'

export interface VendorServiceChargeRecord {
  service_charge_paid_at?: string | null
  service_charge_expires_at?: string | null
  service_charge_years_paid?: number | null
  service_charge_reminder_sent_at?: string | null
  service_charge_grace_notified_at?: string | null
  status?: string
  suspended_reason?: VendorSuspendedReason | null
}

export function isServiceChargePaid(v: VendorServiceChargeRecord): boolean {
  return !!(v.service_charge_paid_at && v.service_charge_expires_at)
}

export function getServiceChargePaymentStatus(v: VendorServiceChargeRecord): ServiceChargePaymentStatus {
  return isServiceChargePaid(v) ? 'paid' : 'unpaid'
}

export function getServiceChargeLifecycle(
  v: VendorServiceChargeRecord,
  today: Date = new Date()
): ServiceChargeLifecycle {
  if (!isServiceChargePaid(v)) return 'unpaid'

  const expires = startOfDay(parseISO(String(v.service_charge_expires_at).slice(0, 10)))
  const now = startOfDay(today)

  if (now <= expires) {
    const daysUntilExpiry = differenceInCalendarDays(expires, now)
    if (daysUntilExpiry <= SERVICE_CHARGE_REMINDER_DAYS) return 'expiring_soon'
    return 'active'
  }

  const daysPastExpiry = differenceInCalendarDays(now, expires)
  if (daysPastExpiry <= SERVICE_CHARGE_GRACE_DAYS) return 'grace_period'
  return 'overdue'
}

export function normalizeServiceChargeYears(years: number): number {
  const n = Math.round(Number(years))
  if (!Number.isFinite(n) || n < 1 || n > SERVICE_CHARGE_MAX_YEARS) {
    throw new Error(`Years must be between 1 and ${SERVICE_CHARGE_MAX_YEARS}`)
  }
  return n
}

export type ServiceChargePaymentPreview = {
  years: number
  mode: ServiceChargeExtendMode
  periodStartsAt: string
  expiresAt: string
  summary: string
  detailLines: string[]
}

/** Compute new expiry for a payment (client + server). */
export function previewServiceChargePayment(
  paidAt: Date,
  years: number,
  currentExpiresAt: string | null | undefined,
  mode: ServiceChargeExtendMode,
  today: Date = new Date()
): ServiceChargePaymentPreview {
  const y = normalizeServiceChargeYears(years)
  const paidDay = startOfDay(paidAt)
  const todayDay = startOfDay(today)
  const currentExp = currentExpiresAt
    ? startOfDay(parseISO(String(currentExpiresAt).slice(0, 10)))
    : null

  let periodStart: Date
  let expires: Date
  const detailLines: string[] = []

  if (mode === 'extend_current' && currentExp && currentExp >= todayDay) {
    periodStart = addDays(currentExp, 1)
    expires = addYears(currentExp, y)
    detailLines.push(`Current coverage ends: ${format(currentExp, 'dd MMM yyyy')}`)
    detailLines.push(`Extension: +${y} year${y === 1 ? '' : 's'} after that date`)
    detailLines.push(`New coverage ends: ${format(expires, 'dd MMM yyyy')}`)
  } else {
    periodStart = paidDay
    expires = addYears(paidDay, y)
    detailLines.push(`Payment date: ${format(paidDay, 'dd MMM yyyy')}`)
    detailLines.push(`Period: ${y} year${y === 1 ? '' : 's'} from payment date`)
    detailLines.push(`Coverage ends: ${format(expires, 'dd MMM yyyy')}`)
  }

  const summary =
    mode === 'extend_current' && currentExp && currentExp >= todayDay
      ? `${y}-year extension after ${format(currentExp, 'dd MMM yyyy')} → valid until ${format(expires, 'dd MMM yyyy')}`
      : `${y}-year plan from ${format(paidDay, 'dd MMM yyyy')} → valid until ${format(expires, 'dd MMM yyyy')}`

  return {
    years: y,
    mode,
    periodStartsAt: format(periodStart, 'yyyy-MM-dd'),
    expiresAt: format(expires, 'yyyy-MM-dd'),
    summary,
    detailLines,
  }
}

export function computeServiceChargeExpiryFromPaidAt(paidAt: Date, years = 1): string {
  return previewServiceChargePayment(paidAt, years, null, 'from_payment_date').expiresAt
}

export function defaultServiceChargeExtendMode(
  v: VendorServiceChargeRecord,
  today: Date = new Date()
): ServiceChargeExtendMode {
  if (!v.service_charge_expires_at) return 'from_payment_date'
  const exp = startOfDay(parseISO(String(v.service_charge_expires_at).slice(0, 10)))
  return exp >= startOfDay(today) ? 'extend_current' : 'from_payment_date'
}

export function formatServiceChargeCoverage(v: VendorServiceChargeRecord): string | null {
  if (!v.service_charge_expires_at) return null
  const years = v.service_charge_years_paid
  const expires = formatDateLabel(v.service_charge_expires_at)
  if (years && years > 1) {
    return `Covered through ${expires} (${years}-year payment)`
  }
  return `Covered through ${expires}`
}

function formatDateLabel(dateStr: string): string {
  try {
    return format(parseISO(String(dateStr).slice(0, 10)), 'dd MMM yyyy')
  } catch {
    return dateStr
  }
}

export function daysUntilServiceChargeExpiry(
  v: VendorServiceChargeRecord,
  today: Date = new Date()
): number | null {
  if (!v.service_charge_expires_at) return null
  const expires = startOfDay(parseISO(String(v.service_charge_expires_at).slice(0, 10)))
  return differenceInCalendarDays(expires, startOfDay(today))
}

export function daysRemainingInGrace(
  v: VendorServiceChargeRecord,
  today: Date = new Date()
): number | null {
  if (!v.service_charge_expires_at) return null
  const graceEnd = addDays(
    startOfDay(parseISO(String(v.service_charge_expires_at).slice(0, 10))),
    SERVICE_CHARGE_GRACE_DAYS
  )
  return Math.max(0, differenceInCalendarDays(graceEnd, startOfDay(today)))
}

export type ServiceChargeBanner = {
  variant: 'amber' | 'red'
  title: string
  message: string
  lifecycle: ServiceChargeLifecycle
}

export function getServiceChargeBanner(
  v: VendorServiceChargeRecord,
  today: Date = new Date()
): ServiceChargeBanner | null {
  const lifecycle = getServiceChargeLifecycle(v, today)
  const expiresLabel = v.service_charge_expires_at
    ? format(parseISO(String(v.service_charge_expires_at).slice(0, 10)), 'dd MMM yyyy')
    : null

  switch (lifecycle) {
    case 'unpaid':
      return {
        variant: 'amber',
        lifecycle,
        title: 'Annual service charge unpaid',
        message:
          'Your annual DistroGH service charge has not been recorded. Contact your administrator to arrange payment and activate your subscription.',
      }
    case 'expiring_soon': {
      const days = daysUntilServiceChargeExpiry(v, today)
      return {
        variant: 'amber',
        lifecycle,
        title: 'Service charge renews soon',
        message: `Your annual service charge expires on ${expiresLabel}${
          days != null ? ` (${days} day${days === 1 ? '' : 's'} left)` : ''
        }. Please renew with your administrator to avoid interruption.`,
      }
    }
    case 'grace_period': {
      const graceDays = daysRemainingInGrace(v, today)
      return {
        variant: 'red',
        lifecycle,
        title: 'Service charge expired — grace period',
        message: `Your service charge expired on ${expiresLabel}. You have ${
          graceDays ?? SERVICE_CHARGE_GRACE_DAYS
        } day${graceDays === 1 ? '' : 's'} left to renew before your account is suspended.`,
      }
    }
    default:
      return null
  }
}

export const SERVICE_CHARGE_LIFECYCLE_LABELS: Record<ServiceChargeLifecycle, string> = {
  unpaid: 'Unpaid',
  active: 'Paid — active',
  expiring_soon: 'Renewal due (30 days)',
  grace_period: 'Expired — grace period',
  overdue: 'Overdue — suspend',
}
