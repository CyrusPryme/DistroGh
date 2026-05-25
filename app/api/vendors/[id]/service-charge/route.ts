import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { recordVendorServiceChargePayment } from '@/lib/vendor-service-charge-enforce'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const paidAtRaw = body?.paid_at != null ? String(body.paid_at).trim() : ''
    const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date()
    if (Number.isNaN(paidAt.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid paid_at date' }, { status: 400 })
    }
    const years = body?.years != null ? Number(body.years) : 1
    const mode =
      body?.mode === 'extend_current' ? 'extend_current' : ('from_payment_date' as const)

    const pool = getDbPool()
    let row
    try {
      row = await recordVendorServiceChargePayment(pool, id, { paidAt, years, mode })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid payment'
      return NextResponse.json({ success: false, error: msg }, { status: 400 })
    }
    if (!row) {
      return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 })
    }

    const { rows } = await pool.query(`select * from public.vendors where id = $1::uuid`, [id])
    return NextResponse.json({ success: true, data: rows[0] ?? null })
  } catch (e) {
    return apiError(e, 'Failed to record service charge payment')
  }
}
