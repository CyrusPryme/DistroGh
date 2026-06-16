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
      `SELECT fc.*, u.email as created_by_email
       FROM public.developer_fee_configs fc
       LEFT JOIN public.users u ON u.id = fc.created_by
       ORDER BY fc.is_active DESC, fc.scope, fc.priority DESC, fc.created_at DESC`
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (e) {
    return apiError(e, 'Failed to load fee configs')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireDeveloper()
    const body = await req.json().catch(() => null)
    const {
      name, description, fee_type, percentage_rate, fixed_amount,
      hybrid_mode, scope, scope_id, effective_from, effective_to, is_active, priority
    } = body ?? {}

    if (!name?.trim()) return NextResponse.json({ success: false, error: 'Name is required.' }, { status: 400 })
    if (!['percentage', 'fixed', 'hybrid'].includes(fee_type)) return NextResponse.json({ success: false, error: 'Invalid fee_type.' }, { status: 400 })
    if (!['global', 'vendor', 'product', 'category'].includes(scope)) return NextResponse.json({ success: false, error: 'Invalid scope.' }, { status: 400 })

    const pool = getDbPool()
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.developer_fee_configs
         (name, description, fee_type, percentage_rate, fixed_amount, hybrid_mode, scope, scope_id, effective_from, effective_to, is_active, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [name.trim(), description?.trim() ?? null, fee_type, Number(percentage_rate ?? 0), Number(fixed_amount ?? 0),
       hybrid_mode ?? null, scope, scope_id ?? null,
       effective_from || null, effective_to || null, is_active !== false, Number(priority ?? 0), session.user_id]
    )

    await writeAuditLog(pool, { ...actorFromSession(session), action: 'create_fee_config', module: 'platform_revenue', target_id: row.id, target_label: name, metadata: { fee_type, scope }, ip_address: ipFromRequest(req) })
    return NextResponse.json({ success: true, data: row }, { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create fee config')
  }
}
