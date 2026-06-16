import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/admin/users/[id] — get single admin user with permissions */
export async function GET(_: Request, ctx: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await ctx.params
    const pool = getDbPool()

    const { rows } = await pool.query(
      `SELECT u.id as user_id, u.email, ap.*, creator.email as created_by_email
       FROM public.admin_profiles ap
       JOIN public.users u ON u.id = ap.user_id
       LEFT JOIN public.users creator ON creator.id = ap.created_by
       WHERE ap.user_id = $1 AND ap.deleted_at IS NULL`,
      [id]
    )
    if (!rows[0]) return NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 })

    const { rows: permRows } = await pool.query(
      `SELECT module, action FROM public.admin_user_permissions WHERE user_id = $1`,
      [id]
    )
    const permissions = permRows.map((r: any) => `${r.module}:${r.action}`)

    return NextResponse.json({ success: true, data: { ...rows[0], permissions } })
  } catch (e) {
    return apiError(e, 'Failed to load admin user')
  }
}

/** PATCH /api/admin/users/[id] — update profile / permissions / status */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const pool = getDbPool()

    const { first_name, last_name, phone, admin_role, status, notes, permissions, password } = body ?? {}

    // Prevent super_admin from modifying themselves (prevent lockout)
    if (id === session.user_id && status === 'suspended') {
      return NextResponse.json({ success: false, error: 'You cannot suspend your own account.' }, { status: 400 })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Update admin_profile fields
      const fields: string[] = []
      const vals: unknown[] = []
      let i = 1
      const allowed = ['first_name', 'last_name', 'phone', 'admin_role', 'status', 'notes'] as const
      for (const key of allowed) {
        if (body && key in body) {
          fields.push(`${key} = $${i++}`)
          vals.push((body as any)[key])
        }
      }
      if (fields.length > 0) {
        fields.push(`updated_at = now()`)
        vals.push(id)
        await client.query(
          `UPDATE public.admin_profiles SET ${fields.join(', ')} WHERE user_id = $${i} AND deleted_at IS NULL`,
          vals
        )
      }

      // Password reset
      if (password) {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.')
        const hash = await bcrypt.hash(password, 12)
        await client.query(`UPDATE public.users SET password_hash = $1 WHERE id = $2`, [hash, id])
      }

      // Permission update
      if (Array.isArray(permissions)) {
        await client.query(`DELETE FROM public.admin_user_permissions WHERE user_id = $1`, [id])
        if (permissions.length > 0) {
          const permValues = permissions.map((_: string, idx: number) =>
            `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`
          )
          const permArgs: unknown[] = permissions.flatMap((key: string) => {
            const [mod, act] = key.split(':')
            return [id, mod, act]
          })
          await client.query(
            `INSERT INTO public.admin_user_permissions (user_id, module, action) VALUES ${permValues.join(',')} ON CONFLICT DO NOTHING`,
            permArgs
          )
        }
      }

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }

    await writeAuditLog(pool, {
      ...actorFromSession(session),
      action: password ? 'reset_password' : 'update_admin_account',
      module: 'admin_accounts',
      target_id: id,
      metadata: { fields: Object.keys(body ?? {}), permissions_count: Array.isArray(permissions) ? permissions.length : undefined },
      ip_address: ipFromRequest(req),
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to update admin user')
  }
}

/** DELETE /api/admin/users/[id] — soft-delete */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await ctx.params

    if (id === session.user_id) {
      return NextResponse.json({ success: false, error: 'You cannot delete your own account.' }, { status: 400 })
    }

    const pool = getDbPool()
    await pool.query(
      `UPDATE public.admin_profiles SET deleted_at = now(), status = 'suspended', updated_at = now() WHERE user_id = $1`,
      [id]
    )

    await writeAuditLog(pool, {
      ...actorFromSession(session),
      action: 'delete_admin_account',
      module: 'admin_accounts',
      target_id: id,
      ip_address: ipFromRequest(req),
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to delete admin user')
  }
}
