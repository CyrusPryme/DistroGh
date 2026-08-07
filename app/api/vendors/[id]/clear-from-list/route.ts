import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession } from '@/lib/rbac/audit'

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      update public.vendors
      set list_cleared_at = now(), updated_at = now()
      where id = $1::uuid
        and deleted_at is not null
        and list_cleared_at is null
      returning id, name, deleted_at, momo_number, momo_network
      `,
      [id]
    )
    if (!rows[0]) {
      return NextResponse.json(
        { success: false, error: 'Vendor is not deleted or was already cleared from the list' },
        { status: 400 }
      )
    }
    const vendor = rows[0]
    await writeAuditLog(pool, {
      ...actorFromSession(session),
      action: 'vendor_cleared_from_list',
      module: 'vendors',
      target_id: vendor.id,
      target_label: vendor.name,
      metadata: {
        deleted_at: vendor.deleted_at,
        momo_number: vendor.momo_number,
        momo_network: vendor.momo_network,
      },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to clear vendor from list')
  }
}
