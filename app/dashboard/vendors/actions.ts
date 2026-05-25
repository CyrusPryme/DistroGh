'use server'

import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { requireAdmin, getVendorBalanceAmount } from '@/lib/auth/require'
import { recordVendorServiceChargePayment } from '@/lib/vendor-service-charge-enforce'
import type { Vendor } from '@/types'
import type { VendorFormValues } from '@/lib/validations'

export async function createVendorAdmin(
  payload: VendorFormValues
): Promise<{ vendor: Vendor } | { error: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Only admins can add vendors' }
  }

  const name = payload.name?.trim()
  const momo_number = payload.momo_number?.trim()
  if (!name || name.length < 2) return { error: 'Vendor name is required (at least 2 characters)' }
  if (!momo_number || momo_number.length < 10) return { error: 'Mobile money number is required' }
  if (!['MTN', 'Vodafone', 'AirtelTigo'].includes(payload.momo_network)) {
    return { error: 'Invalid mobile money network' }
  }
  const default_commission = payload.default_commission ?? 0
  if (default_commission < 0 || default_commission > 100) return { error: 'Commission must be 0–100' }
  const facility_expiry_date = payload.facility_expiry_date?.trim() || null

  const pool = getDbPool()
  const byName = await pool.query(
    `select id from public.vendors where deleted_at is null and lower(name) = lower($1) limit 1`,
    [name]
  )
  if (byName.rowCount) return { error: 'A vendor with this name already exists' }

  const byMomo = await pool.query(
    `select id from public.vendors where deleted_at is null and momo_number = $1 limit 1`,
    [momo_number]
  )
  if (byMomo.rowCount) return { error: 'A vendor with this mobile money number already exists' }

  const { rows } = await pool.query(
    `
    insert into public.vendors (
      name, momo_number, momo_network, default_commission, facility_expiry_date,
      contact_phone, description, login_email, initial_password, status
    )
    values ($1, $2, $3, $4, $5, $6, $7, null, null, 'active')
    returning *
    `,
    [
      name,
      momo_number,
      payload.momo_network,
      default_commission,
      facility_expiry_date,
      payload.contact_phone?.trim() || null,
      payload.description?.trim() || null,
    ]
  )
  return { vendor: rows[0] as Vendor }
}

export async function updateVendorAdmin(
  vendorId: string,
  payload: Partial<VendorFormValues>
): Promise<{ vendor: Vendor } | { error: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Only admins can update vendors' }
  }
  if (!vendorId?.trim()) return { error: 'Vendor ID required' }

  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (payload.name !== undefined) {
    const t = payload.name?.trim()
    if (!t || t.length < 2) return { error: 'Vendor name must be at least 2 characters' }
    fields.push(`name = $${i++}`)
    values.push(t)
  }
  if (payload.momo_number !== undefined) {
    const t = payload.momo_number?.trim()
    if (!t || t.length < 10) return { error: 'Mobile money number is required' }
    fields.push(`momo_number = $${i++}`)
    values.push(t)
  }
  if (payload.momo_network !== undefined) {
    if (!['MTN', 'Vodafone', 'AirtelTigo'].includes(payload.momo_network)) return { error: 'Invalid network' }
    fields.push(`momo_network = $${i++}`)
    values.push(payload.momo_network)
  }
  if (payload.default_commission !== undefined) {
    if (payload.default_commission < 0 || payload.default_commission > 100) return { error: 'Commission must be 0–100' }
    fields.push(`default_commission = $${i++}`)
    values.push(payload.default_commission)
  }
  if (payload.facility_expiry_date !== undefined) {
    fields.push(`facility_expiry_date = $${i++}`)
    values.push(payload.facility_expiry_date?.trim() || null)
  }
  if ((payload as { fda_certificate_path?: string }).fda_certificate_path !== undefined) {
    fields.push(`fda_certificate_path = $${i++}`)
    values.push((payload as { fda_certificate_path?: string }).fda_certificate_path ?? null)
  }
  if (payload.contact_phone !== undefined) {
    fields.push(`contact_phone = $${i++}`)
    values.push(payload.contact_phone?.trim() || null)
  }
  if (payload.description !== undefined) {
    fields.push(`description = $${i++}`)
    values.push(payload.description?.trim() || null)
  }
  if (fields.length === 0) return { error: 'No fields to update' }

  values.push(vendorId)
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    update public.vendors
    set ${fields.join(', ')}, updated_at = now()
    where id = $${i}::uuid and deleted_at is null
    returning *
    `,
    values
  )
  if (!rows[0]) return { error: 'Vendor not found' }
  return { vendor: rows[0] as Vendor }
}

export async function createDeductionAdmin(
  vendorId: string,
  payload: { amount: number; reason: string; deduction_date?: string }
): Promise<{ success: true } | { error: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Only admins can add deductions' }
  }
  if (!vendorId?.trim()) return { error: 'Vendor ID required' }
  if (payload.amount <= 0) return { error: 'Amount must be greater than 0' }
  if (!payload.reason?.trim()) return { error: 'Reason is required' }

  const pool = getDbPool()
  await pool.query(
    `
    insert into public.vendor_deductions (vendor_id, amount, reason, deduction_date)
    values ($1::uuid, $2, $3, $4::date)
    `,
    [
      vendorId,
      payload.amount,
      payload.reason.trim(),
      payload.deduction_date || new Date().toISOString().slice(0, 10),
    ]
  )
  return { success: true }
}

export async function verifyVendor(vendorId: string): Promise<{ success: true }> {
  const { user } = await requireAdmin()
  const pool = getDbPool()
  const { rowCount } = await pool.query(
    `
    update public.vendors
    set status = 'active', verified_at = now(), verified_by = $2::uuid, updated_at = now()
    where id = $1::uuid
    `,
    [vendorId, user.id]
  )
  if (!rowCount) throw new Error('Failed to verify vendor')
  return { success: true }
}

export async function suspendVendor(vendorId: string): Promise<{ success: true }> {
  await requireAdmin()
  const pool = getDbPool()
  const { rowCount } = await pool.query(
    `
    update public.vendors
    set status = 'suspended', suspended_reason = 'manual', updated_at = now()
    where id = $1::uuid
    `,
    [vendorId]
  )
  if (!rowCount) throw new Error('Failed to suspend vendor')
  return { success: true }
}

export async function reactivateVendor(vendorId: string): Promise<{ success: true }> {
  await requireAdmin()
  const pool = getDbPool()
  const { rowCount } = await pool.query(
    `
    update public.vendors
    set status = 'active', suspended_reason = null, updated_at = now()
    where id = $1::uuid and status = 'suspended'
    `,
    [vendorId]
  )
  if (!rowCount) throw new Error('Failed to reactivate vendor')
  return { success: true }
}

export async function recordVendorServiceChargePaymentAdmin(
  vendorId: string,
  payload: {
    paid_at?: string
    years?: number
    mode?: 'from_payment_date' | 'extend_current'
  }
): Promise<{ vendor: Vendor } | { error: string }> {
  try {
    await requireAdmin()
  } catch {
    return { error: 'Only admins can record service charge payments' }
  }
  if (!vendorId?.trim()) return { error: 'Vendor ID required' }

  const paidAt = payload.paid_at?.trim() ? new Date(payload.paid_at) : new Date()
  if (Number.isNaN(paidAt.getTime())) return { error: 'Invalid payment date' }

  const years = payload.years ?? 1
  const mode = payload.mode === 'extend_current' ? 'extend_current' : 'from_payment_date'

  const pool = getDbPool()
  try {
    const row = await recordVendorServiceChargePayment(pool, vendorId, { paidAt, years, mode })
    if (!row) return { error: 'Vendor not found' }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Invalid payment' }
  }

  const { rows } = await pool.query(`select * from public.vendors where id = $1::uuid`, [vendorId])
  return { vendor: rows[0] as Vendor }
}

export async function requestVerificationChanges(vendorId: string, message: string): Promise<{ success: true }> {
  await requireAdmin()
  if (!vendorId?.trim()) throw new Error('Vendor ID required')
  const pool = getDbPool()
  await pool.query(
    `update public.vendors set verification_feedback = $2, updated_at = now() where id = $1::uuid`,
    [vendorId, message?.trim() || null]
  )
  return { success: true }
}

export async function getVendorDocumentUrl(path: string): Promise<{ url: string }> {
  await requireAdmin()
  if (!path?.trim()) throw new Error('No document path')
  const trimmed = path.trim()
  return { url: `/api/vendor-documents/file?path=${encodeURIComponent(trimmed)}` }
}

export async function resetVendorPassword(vendorId: string, newPassword: string): Promise<{ success: true }> {
  await requireAdmin()
  if (!vendorId?.trim()) throw new Error('Vendor ID required')
  const trimmed = newPassword?.trim()
  if (!trimmed || trimmed.length < 8) throw new Error('Password must be at least 8 characters')

  const pool = getDbPool()
  const profileRes = await pool.query(
    `select user_id from public.profiles where vendor_id = $1::uuid limit 1`,
    [vendorId]
  )
  const userId = profileRes.rows[0]?.user_id
  if (!userId) throw new Error('Vendor has no linked login account')

  const password_hash = await bcrypt.hash(trimmed, 10)
  await pool.query(`update public.users set password_hash = $2 where id = $1::uuid`, [userId, password_hash])
  await pool.query(
    `update public.vendors set initial_password = $2, updated_at = now() where id = $1::uuid`,
    [vendorId, trimmed]
  )
  return { success: true }
}

export async function getDeletedPendingAuthCleanup(): Promise<
  { id: string; name: string; login_email: string | null; deleted_at: string }[]
> {
  await requireAdmin()
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select id, name, login_email, deleted_at
    from public.vendors
    where deleted_at is not null and auth_cleanup_done_at is null
    order by deleted_at desc
    `
  )
  return rows as { id: string; name: string; login_email: string | null; deleted_at: string }[]
}

export async function softDeleteVendorCascade(vendorId: string): Promise<{ success: true }> {
  await requireAdmin()
  if (!vendorId?.trim()) throw new Error('Vendor ID required')

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const { rows: productRows } = await client.query(
      `select id from public.products where vendor_id = $1::uuid and deleted_at is null`,
      [vendorId]
    )
    const ids = productRows.map((p: { id: string }) => p.id)

    if (ids.length > 0) {
      await client.query(
        `update public.sales set deleted_at = now(), updated_at = now() where product_id = any($1::uuid[]) and deleted_at is null`,
        [ids]
      )
      await client.query(
        `update public.product_returns set deleted_at = now(), updated_at = now() where product_id = any($1::uuid[]) and deleted_at is null`,
        [ids]
      )
    }

    await client.query(
      `update public.products set deleted_at = now(), updated_at = now() where vendor_id = $1::uuid and deleted_at is null`,
      [vendorId]
    )
    await client.query(
      `update public.payouts set deleted_at = now(), updated_at = now() where vendor_id = $1::uuid and deleted_at is null`,
      [vendorId]
    )
    await client.query(
      `update public.intakes set deleted_at = now() where vendor_id = $1::uuid and deleted_at is null`,
      [vendorId]
    )
    await client.query(
      `update public.profiles set vendor_id = null, role = 'user', updated_at = now() where vendor_id = $1::uuid`,
      [vendorId]
    )
    const { rowCount } = await client.query(
      `update public.vendors set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null`,
      [vendorId]
    )
    if (!rowCount) throw new Error('Vendor not found')
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
  return { success: true }
}

export async function markVendorAuthCleanupDone(vendorId: string): Promise<{ success: true }> {
  await requireAdmin()
  if (!vendorId?.trim()) throw new Error('Vendor ID required')
  const pool = getDbPool()
  await pool.query(
    `update public.vendors set auth_cleanup_done_at = now(), updated_at = now() where id = $1::uuid`,
    [vendorId]
  )
  return { success: true }
}

export async function getDeactivationRequestForVendor(vendorId: string) {
  await requireAdmin()
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select * from public.vendor_deactivation_requests
    where vendor_id = $1::uuid
    order by requested_at desc
    limit 1
    `,
    [vendorId]
  )
  return rows[0] ?? null
}

export async function getDeactivationRequests(status?: 'pending' | 'approved' | 'rejected') {
  await requireAdmin()
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      r.*,
      json_build_object(
        'id', v.id,
        'name', v.name,
        'login_email', v.login_email,
        'contact_phone', v.contact_phone
      ) as vendor
    from public.vendor_deactivation_requests r
    left join public.vendors v on v.id = r.vendor_id
    where ($1::text is null or r.status = $1::text)
    order by r.requested_at desc
    `,
    [status ?? null]
  )
  return rows
}

export async function approveDeactivationRequest(requestId: string): Promise<{ success: true } | { error: string }> {
  const { user } = await requireAdmin()
  const pool = getDbPool()
  const reqRes = await pool.query(
    `select vendor_id, status from public.vendor_deactivation_requests where id = $1::uuid`,
    [requestId]
  )
  const req = reqRes.rows[0]
  if (!req) return { error: 'Request not found' }
  if (req.status !== 'pending') return { error: 'Request already processed' }

  const balance = await getVendorBalanceAmount(req.vendor_id)
  if (balance !== 0) {
    return { error: 'Vendor still has outstanding balance. Clear obligations before approving.' }
  }

  await softDeleteVendorCascade(req.vendor_id)
  await pool.query(
    `
    update public.vendor_deactivation_requests
    set status = 'approved', reviewed_at = now(), reviewed_by = $2::uuid,
        admin_notes = 'Approved. Vendor soft-deleted.'
    where id = $1::uuid
    `,
    [requestId, user.id]
  )
  return { success: true }
}

export async function rejectDeactivationRequest(
  requestId: string,
  adminNotes?: string
): Promise<{ success: true } | { error: string }> {
  const { user } = await requireAdmin()
  const pool = getDbPool()
  const reqRes = await pool.query(
    `select status from public.vendor_deactivation_requests where id = $1::uuid`,
    [requestId]
  )
  const req = reqRes.rows[0]
  if (!req) return { error: 'Request not found' }
  if (req.status !== 'pending') return { error: 'Request already processed' }

  await pool.query(
    `
    update public.vendor_deactivation_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = $2::uuid, admin_notes = $3
    where id = $1::uuid
    `,
    [requestId, user.id, adminNotes?.trim() || null]
  )
  return { success: true }
}
