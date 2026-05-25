'use server'

import { getDbPool } from '@/lib/db'
import { readSessionCookie } from '@/lib/auth/session'

/**
 * Ensures a vendor profile row exists for the logged-in user email when vendor_id is missing.
 * Used after legacy migrations where profile.vendor_id was not set.
 */
export async function ensureVendorProfileByEmail(): Promise<{ vendor_id: string | null }> {
  const session = await readSessionCookie()
  if (!session?.email) return { vendor_id: null }
  if (session.vendor_id) return { vendor_id: session.vendor_id }

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select id from public.vendors
    where lower(login_email) = lower($1) and deleted_at is null
    limit 1
    `,
    [session.email]
  )
  const vendorId = rows[0]?.id ?? null
  if (!vendorId) return { vendor_id: null }

  await pool.query(
    `
    update public.profiles
    set vendor_id = $2::uuid, role = 'vendor', updated_at = now()
    where user_id = $1::uuid
    `,
    [session.user_id, vendorId]
  )
  return { vendor_id: vendorId }
}
