import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function GET() {
  try {
    await requireAdminSession()
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select count(*)::int as count
      from public.delivery_runs
      where deleted_at is null
        and confirmed_at is null
      `
    )
    return NextResponse.json({ success: true, data: { count: rows[0]?.count ?? 0 } })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load pending deliveries'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
