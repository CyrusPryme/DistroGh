import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

const ALLOWED_TABLES = ['vendors', 'products', 'sales', 'payouts', 'delivery_runs'] as const
type AllowedTable = typeof ALLOWED_TABLES[number]

export async function POST(req: Request) {
  try {
    const session = await requireDeveloper()
    const body = await req.json().catch(() => null)
    const { table, id } = body ?? {}

    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      return NextResponse.json({ success: false, error: 'Invalid table.' }, { status: 400 })
    }
    if (!id) return NextResponse.json({ success: false, error: 'Record ID is required.' }, { status: 400 })

    const pool = getDbPool()
    const result = await pool.query(
      `UPDATE public.${table} SET deleted_at = NULL WHERE id = $1::uuid AND deleted_at IS NOT NULL RETURNING id`,
      [id]
    )
    if (!result.rowCount) {
      return NextResponse.json({ success: false, error: 'Record not found or already active.' }, { status: 404 })
    }

    await writeAuditLog(pool, {
      ...actorFromSession(session),
      action: 'restore_record',
      module: 'data_recovery',
      target_id: id,
      metadata: { table },
      ip_address: ipFromRequest(req),
    })

    return NextResponse.json({ success: true, message: `Record restored from ${table}.` })
  } catch (e) {
    return apiError(e, 'Failed to restore record')
  }
}
