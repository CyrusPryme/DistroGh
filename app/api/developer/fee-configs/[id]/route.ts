import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireDeveloper()
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const pool = getDbPool()

    const allowed = ['name','description','fee_type','percentage_rate','fixed_amount','hybrid_mode','scope','scope_id','effective_from','effective_to','is_active','priority'] as const
    const fields: string[] = []
    const vals: unknown[] = []
    let i = 1
    for (const key of allowed) {
      if (body && key in body) { fields.push(`${key} = $${i++}`); vals.push((body as any)[key]) }
    }
    if (!fields.length) return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
    fields.push('updated_at = now()')
    vals.push(id)
    await pool.query(`UPDATE public.developer_fee_configs SET ${fields.join(', ')} WHERE id = $${i}::uuid`, vals)
    await writeAuditLog(pool, { ...actorFromSession(session), action: 'update_fee_config', module: 'platform_revenue', target_id: id, ip_address: ipFromRequest(req) })
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to update fee config')
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const session = await requireDeveloper()
    const { id } = await ctx.params
    const pool = getDbPool()
    await pool.query(`UPDATE public.developer_fee_configs SET is_active = false, updated_at = now() WHERE id = $1::uuid`, [id])
    await writeAuditLog(pool, { ...actorFromSession(session), action: 'deactivate_fee_config', module: 'platform_revenue', target_id: id, ip_address: ipFromRequest(req) })
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to deactivate fee config')
  }
}
