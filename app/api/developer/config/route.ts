import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

export async function GET() {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const { rows } = await pool.query(
      `SELECT key, value, value_type, description, category, is_sensitive, updated_at
       FROM public.system_config ORDER BY category, key`
    )
    // Mask sensitive values
    const safe = rows.map((r: any) => ({ ...r, value: r.is_sensitive ? '••••••••' : r.value }))
    return NextResponse.json({ success: true, data: safe })
  } catch (e) {
    return apiError(e, 'Failed to load config')
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireDeveloper()
    const body = await req.json().catch(() => null)
    const updates = (Array.isArray(body) ? body : [body]) as Array<{ key: string; value: string }>

    if (!updates.length || !updates[0]?.key) {
      return NextResponse.json({ success: false, error: 'key and value are required.' }, { status: 400 })
    }

    const pool = getDbPool()
    for (const { key, value } of updates) {
      await pool.query(
        `UPDATE public.system_config SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3`,
        [String(value), session.user_id, key]
      )
    }

    await writeAuditLog(pool, {
      ...actorFromSession(session),
      action: 'update_system_config',
      module: 'configuration',
      metadata: { keys: updates.map(u => u.key) },
      ip_address: ipFromRequest(req),
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to update config')
  }
}
