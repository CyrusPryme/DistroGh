'use server'

import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { getVendorBalanceAmount } from '@/lib/auth/require'

/**
 * @deprecated Upload API now saves FDA metadata directly. Kept for compatibility.
 */
export async function submitVendorOnboarding(
  vendorId: string,
  payload: { facility_expiry_date: string; fda_certificate_path?: string }
): Promise<{ success: true }> {
  const session = await requireSession()
  if (session.role !== 'vendor' || session.vendor_id !== vendorId) {
    throw new Error('You can only update your own vendor profile')
  }

  const pool = getDbPool()
  await pool.query(
    `
    update public.vendors
    set
      facility_expiry_date = $2,
      verification_feedback = null,
      status = 'pending_verification',
      updated_at = now()
    where id = $1::uuid
    `,
    [vendorId, payload.facility_expiry_date || null]
  )
  return { success: true }
}

/** Vendor can update their own MoMo number and network (for payouts). */
export async function updateVendorMomo(
  vendorId: string,
  payload: { momo_number: string; momo_network: string }
): Promise<{ success: true }> {
  const session = await requireSession()
  if (session.role !== 'vendor' || session.vendor_id !== vendorId) {
    throw new Error('You can only update your own vendor profile')
  }

  const trimmed = payload.momo_number?.trim() ?? ''
  const network = (payload.momo_network?.trim() || 'MTN') as 'MTN' | 'Vodafone' | 'AirtelTigo'
  if (!trimmed) throw new Error('MoMo number is required')

  const pool = getDbPool()
  await pool.query(
    `update public.vendors set momo_number = $2, momo_network = $3, updated_at = now() where id = $1::uuid`,
    [vendorId, trimmed, network]
  )
  return { success: true }
}

/** Vendor can update their own business details and contact info. */
export async function updateVendorDetails(
  vendorId: string,
  payload: { name?: string; contact_phone?: string | null; description?: string | null }
): Promise<{ success: true }> {
  const session = await requireSession()
  if (session.role !== 'vendor' || session.vendor_id !== vendorId) {
    throw new Error('You can only update your own vendor profile')
  }

  const updates: Record<string, unknown> = {}
  if (payload.name !== undefined) {
    const trimmed = payload.name.trim()
    if (trimmed.length < 2) throw new Error('Business name must be at least 2 characters')
    if (trimmed.length > 100) throw new Error('Business name must be at most 100 characters')
    updates.name = trimmed
  }
  if (payload.contact_phone !== undefined) {
    updates.contact_phone = payload.contact_phone?.trim() || null
  }
  if (payload.description !== undefined) {
    updates.description = payload.description?.trim() || null
  }

  const setParts: string[] = []
  const values: any[] = []
  let i = 1
  for (const [k, v] of Object.entries(updates)) {
    setParts.push(`${k} = $${i++}`)
    values.push(v)
  }
  values.push(vendorId)
  const pool = getDbPool()
  await pool.query(
    `update public.vendors set ${setParts.join(', ')}, updated_at = now() where id = $${i}::uuid`,
    values
  )
  return { success: true }
}

/** Vendor requests account deactivation. Allowed only when balance = 0. */
export async function requestVendorDeactivation(
  vendorId: string,
  reason?: string
): Promise<{ success: true } | { error: string }> {
  let session
  try {
    session = await requireSession()
  } catch {
    return { error: 'You must be logged in' }
  }
  if (session.role !== 'vendor' || session.vendor_id !== vendorId) {
    return { error: 'You can only request deactivation for your own account' }
  }

  const pool = getDbPool()
  const existing = await pool.query(
    `select id from public.vendor_deactivation_requests where vendor_id = $1::uuid and status = 'pending' limit 1`,
    [vendorId]
  )
  if (existing.rowCount) return { error: 'You already have a pending deactivation request' }

  const balance = await getVendorBalanceAmount(vendorId, { includeDeductions: false })
  if (Number(balance) !== 0) {
    return { error: 'You must clear all financial obligations (balance = 0) before requesting deactivation' }
  }

  await pool.query(
    `insert into public.vendor_deactivation_requests (vendor_id, reason, status) values ($1::uuid, $2, 'pending')`,
    [vendorId, reason?.trim() || null]
  )
  return { success: true }
}

export async function hasPendingDeactivationRequest(vendorId: string): Promise<boolean> {
  const session = await requireSession()
  if (session.role === 'vendor' && session.vendor_id !== vendorId) return false
  const pool = getDbPool()
  const { rowCount } = await pool.query(
    `select id from public.vendor_deactivation_requests where vendor_id = $1::uuid and status = 'pending' limit 1`,
    [vendorId]
  )
  return (rowCount ?? 0) > 0
}
