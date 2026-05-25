import { getDbPool } from '@/lib/db'
import { readSessionCookie, type SessionPayload } from '@/lib/auth/session'
import { vendorBalanceSql, type VendorBalanceOptions } from '@/lib/vendor-earnings'

export async function requireSession(): Promise<SessionPayload> {
  const session = await readSessionCookie()
  if (!session) throw new Error('Unauthorized')
  return session
}

export async function requireAdminSession(): Promise<SessionPayload> {
  const session = await requireSession()
  if (session.role !== 'admin') throw new Error('Forbidden')
  return session
}

/** Admin, or vendor reading/updating their own vendor row. */
export async function requireVendorSelfOrAdmin(vendorId: string): Promise<SessionPayload> {
  const session = await requireSession()
  if (session.role === 'admin') return session
  if (session.role === 'vendor' && session.vendor_id === vendorId) return session
  throw new Error('Forbidden')
}

/** Alias for server actions (returns user + profile shape). */
export async function requireAdmin() {
  const session = await requireAdminSession()
  return {
    user: { id: session.user_id, email: session.email },
    profile: { role: session.role, vendor_id: session.vendor_id },
  }
}

export async function getServerUserProfile() {
  const session = await readSessionCookie()
  if (!session) return null
  return {
    user: { id: session.user_id, email: session.email },
    profile: { role: session.role, vendor_id: session.vendor_id },
  }
}

/** Vendor balance: sales due − returns − optional deductions − completed payouts. */
export async function getVendorBalanceAmount(
  vendorId: string,
  options: VendorBalanceOptions = {}
): Promise<number> {
  const includeDeductions = options.includeDeductions !== false
  const pool = getDbPool()
  const { rows } = await pool.query(vendorBalanceSql(includeDeductions), [vendorId])
  return Number(rows[0]?.balance ?? 0)
}
