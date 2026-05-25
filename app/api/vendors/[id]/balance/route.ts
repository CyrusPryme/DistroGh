import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { vendorBalanceSql } from '@/lib/vendor-earnings'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await ctx.params

    if (session.role === 'vendor' && session.vendor_id !== id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const includeDeductions = session.role === 'admin'
    const pool = getDbPool()
    const { rows } = await pool.query(vendorBalanceSql(includeDeductions), [id])

    return NextResponse.json({ success: true, data: { balance: Number(rows[0]?.balance ?? 0) } })
  } catch (e) {
    return apiError(e, 'Failed to load vendor balance')
  }
}
