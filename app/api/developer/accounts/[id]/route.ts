import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

type Ctx = { params: Promise<{ id: string }> }

/** PATCH /api/developer/accounts/[id] */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireDeveloper()
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const { first_name, last_name, phone, status, notes, password } = body ?? {}
    const pool = getDbPool()

    // Enforce: cannot suspend self; cannot reduce below 1 active developer
    if (status === 'suspended') {
      if (id === session.user_id) return NextResponse.json({ success: false, error: 'You cannot suspend your own developer account.' }, { status: 400 })
      const { rows } = await pool.query(`SELECT COUNT(*) FROM public.admin_profiles WHERE admin_role = 'developer' AND status = 'active' AND deleted_at IS NULL`)
      if (parseInt(rows[0].count, 10) <= 1) {
        return NextResponse.json({ success: false, error: 'At least one active developer account must remain.' }, { status: 400 })
      }
    }

    const fields: string[] = []
    const vals: unknown[] = []
    let i = 1
    for (const [key, val] of Object.entries({ first_name, last_name, phone, status, notes })) {
      if (val !== undefined) { fields.push(`${key} = $${i++}`); vals.push(val) }
    }
    if (fields.length > 0) {
      fields.push('updated_at = now()')
      vals.push(id)
      await pool.query(`UPDATE public.admin_profiles SET ${fields.join(', ')} WHERE user_id = $${i} AND admin_role = 'developer'`, vals)
    }

    if (password) {
      if (password.length < 8) return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 })
      const hash = await bcrypt.hash(password, 12)
      await pool.query(`UPDATE public.users SET password_hash = $1 WHERE id = $2`, [hash, id])
    }

    await writeAuditLog(pool, { ...actorFromSession(session), action: password ? 'reset_developer_password' : 'update_developer_account', module: 'admin_accounts', target_id: id, ip_address: ipFromRequest(req) })
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to update developer account')
  }
}
