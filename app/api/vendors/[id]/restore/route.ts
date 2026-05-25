import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      update public.vendors
      set deleted_at = null, updated_at = now()
      where id = $1::uuid and deleted_at is not null
      returning *
      `,
      [id]
    )
    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Vendor not found or not deleted.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, data: rows[0] })
  } catch (e) {
    return apiError(e, 'Failed to restore vendor')
  }
}
