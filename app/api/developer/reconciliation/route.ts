import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

/** GET /api/developer/reconciliation — list past reconciliation runs */
export async function GET(req: Request) {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const url = new URL(req.url)
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '30', 10))

    const { rows } = await pool.query(
      `SELECT r.*, u.email as created_by_email
       FROM public.reconciliation_runs r
       LEFT JOIN public.users u ON u.id = r.created_by
       ORDER BY r.created_at DESC
       LIMIT $1`,
      [limit]
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    return apiError(e, 'Failed to load reconciliation runs')
  }
}
