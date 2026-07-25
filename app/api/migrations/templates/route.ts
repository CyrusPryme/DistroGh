import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'

export async function GET() {
  try {
    await requirePermission('historical_migrations', 'read')
    const { rows } = await getDbPool().query(
      `SELECT * FROM public.migration_templates ORDER BY label ASC`
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    return apiError(e, 'Failed to load templates')
  }
}
