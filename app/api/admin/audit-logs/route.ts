import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

/** GET /api/admin/audit-logs */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const pool = getDbPool()
    const url = new URL(req.url)

    const search   = url.searchParams.get('search')?.trim() ?? ''
    const module   = url.searchParams.get('module')?.trim() ?? ''
    const action   = url.searchParams.get('action')?.trim() ?? ''
    const dateFrom = url.searchParams.get('date_from')?.trim() ?? ''
    const dateTo   = url.searchParams.get('date_to')?.trim() ?? ''
    const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
    const limit    = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') ?? '50', 10)))
    const offset   = (page - 1) * limit

    const conditions: string[] = []
    const values: unknown[] = []
    let i = 1

    if (search) {
      conditions.push(`(lower(al.actor_email) LIKE $${i} OR lower(al.action) LIKE $${i} OR lower(al.module) LIKE $${i} OR lower(al.target_label) LIKE $${i})`)
      values.push(`%${search.toLowerCase()}%`)
      i++
    }
    if (module) { conditions.push(`al.module = $${i++}`); values.push(module) }
    if (action) { conditions.push(`al.action = $${i++}`); values.push(action) }
    if (dateFrom) { conditions.push(`al.created_at >= $${i++}`); values.push(dateFrom) }
    if (dateTo)   { conditions.push(`al.created_at < ($${i++}::date + interval '1 day')`); values.push(dateTo) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT al.*, u.email as actor_email_resolved
         FROM public.audit_logs al
         LEFT JOIN public.users u ON u.id = al.actor_id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        [...values, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM public.audit_logs al ${where}`,
        values
      ),
    ])

    const total = parseInt(countRows[0].count, 10)

    // Distinct modules / actions for filter dropdowns
    const { rows: metaRows } = await pool.query(
      `SELECT DISTINCT module, action FROM public.audit_logs ORDER BY module, action`
    )

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
      filters: {
        modules: [...new Set(metaRows.map((r: any) => r.module))],
        actions: [...new Set(metaRows.map((r: any) => r.action))],
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load audit logs')
  }
}
