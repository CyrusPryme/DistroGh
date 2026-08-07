import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession } from '@/lib/rbac/audit'

/** Clear all soft-deleted vendors from the admin list (audit rows retained). */
export async function POST() {
  try {
    const session = await requireAdminSession()
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      update public.vendors
      set list_cleared_at = now(), updated_at = now()
      where deleted_at is not null and list_cleared_at is null
      returning id, name, deleted_at
      `
    )
    if (rows.length) {
      await writeAuditLog(pool, {
        ...actorFromSession(session),
        action: 'vendors_bulk_cleared_from_list',
        module: 'vendors',
        metadata: {
          count: rows.length,
          vendor_ids: rows.map((r: { id: string }) => r.id),
          vendor_names: rows.map((r: { name: string }) => r.name),
        },
      })
    }
    return NextResponse.json({ success: true, data: { cleared: rows.length } })
  } catch (e) {
    return apiError(e, 'Failed to clear deleted vendors')
  }
}
