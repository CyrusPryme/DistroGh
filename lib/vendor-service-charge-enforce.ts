import type { Pool } from 'pg'
import {
  getServiceChargeLifecycle,
  normalizeServiceChargeYears,
  previewServiceChargePayment,
  type ServiceChargeExtendMode,
  type VendorServiceChargeRecord,
} from '@/lib/vendor-service-charge'

export type RecordServiceChargeOptions = {
  paidAt?: Date
  years?: number
  mode?: ServiceChargeExtendMode
}

type VendorRow = VendorServiceChargeRecord & {
  id: string
  status: string
}

export async function enforceVendorServiceCharge(
  pool: Pool,
  vendorId: string
): Promise<VendorRow | null> {
  const { rows } = await pool.query(
    `
    select
      id, status, suspended_reason,
      service_charge_paid_at,
      service_charge_expires_at,
      service_charge_reminder_sent_at,
      service_charge_grace_notified_at
    from public.vendors
    where id = $1::uuid and deleted_at is null
    limit 1
    `,
    [vendorId]
  )
  const vendor = rows[0] as VendorRow | undefined
  if (!vendor) return null

  if (vendor.status === 'pending_verification') return vendor

  const lifecycle = getServiceChargeLifecycle(vendor)
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  if (lifecycle === 'expiring_soon' && !vendor.service_charge_reminder_sent_at) {
    updates.push(`service_charge_reminder_sent_at = now()`)
  }

  if (lifecycle === 'grace_period' && !vendor.service_charge_grace_notified_at) {
    updates.push(`service_charge_grace_notified_at = now()`)
  }

  if (lifecycle === 'overdue' && vendor.status === 'active') {
    updates.push(`status = 'suspended'`)
    updates.push(`suspended_reason = 'service_charge'`)
  }

  if (updates.length === 0) return vendor

  values.push(vendorId)
  const { rows: updated } = await pool.query(
    `
    update public.vendors
    set ${updates.join(', ')}, updated_at = now()
    where id = $${i}::uuid
    returning
      id, status, suspended_reason,
      service_charge_paid_at,
      service_charge_expires_at,
      service_charge_reminder_sent_at,
      service_charge_grace_notified_at
    `,
    values
  )
  return (updated[0] as VendorRow) ?? vendor
}

export async function recordVendorServiceChargePayment(
  pool: Pool,
  vendorId: string,
  options: RecordServiceChargeOptions = {}
): Promise<VendorRow | null> {
  const paidAt = options.paidAt ?? new Date()
  const years = normalizeServiceChargeYears(options.years ?? 1)

  const existing = await pool.query(
    `select service_charge_expires_at from public.vendors where id = $1::uuid and deleted_at is null`,
    [vendorId]
  )
  const currentExpires = existing.rows[0]?.service_charge_expires_at as string | null | undefined
  const mode = options.mode ?? 'from_payment_date'
  const preview = previewServiceChargePayment(paidAt, years, currentExpires, mode)

  const paidIso = paidAt.toISOString()
  const expiresDate = preview.expiresAt

  const { rows } = await pool.query(
    `
    update public.vendors
    set
      service_charge_paid_at = $2::timestamptz,
      service_charge_expires_at = $3::date,
      service_charge_years_paid = $4::int,
      service_charge_reminder_sent_at = null,
      service_charge_grace_notified_at = null,
      status = case
        when status = 'suspended' and suspended_reason = 'service_charge' then 'active'
        else status
      end,
      suspended_reason = case
        when suspended_reason = 'service_charge' then null
        else suspended_reason
      end,
      updated_at = now()
    where id = $1::uuid and deleted_at is null
    returning
      id, status, suspended_reason,
      service_charge_paid_at,
      service_charge_expires_at,
      service_charge_reminder_sent_at,
      service_charge_grace_notified_at
    `,
    [vendorId, paidIso, expiresDate, years]
  )
  return (rows[0] as VendorRow) ?? null
}
