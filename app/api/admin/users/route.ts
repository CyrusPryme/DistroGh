import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'
import { ROLE_PRESETS } from '@/lib/auth/permissions'

/** GET /api/admin/users — list all admin/user accounts */
export async function GET(req: Request) {
  try {
    const session = await requireSuperAdmin()
    const pool = getDbPool()
    const url = new URL(req.url)
    const search = url.searchParams.get('search')?.trim() ?? ''
    const status = url.searchParams.get('status')?.trim() ?? ''
    const admin_role = url.searchParams.get('admin_role')?.trim() ?? ''

    const conditions: string[] = ['ap.deleted_at IS NULL']
    const values: unknown[] = []
    let i = 1

    if (search) {
      conditions.push(
        `(lower(u.email) LIKE $${i} OR lower(ap.first_name) LIKE $${i} OR lower(ap.last_name) LIKE $${i} OR ap.phone LIKE $${i})`
      )
      values.push(`%${search.toLowerCase()}%`)
      i++
    }
    if (status) {
      conditions.push(`ap.status = $${i++}`)
      values.push(status)
    }
    if (admin_role) {
      conditions.push(`ap.admin_role = $${i++}`)
      values.push(admin_role)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows } = await pool.query(
      `SELECT
         u.id as user_id,
         u.email,
         ap.id,
         ap.first_name,
         ap.last_name,
         ap.phone,
         ap.admin_role,
         ap.status,
         ap.notes,
         ap.last_login_at,
         ap.created_at,
         ap.created_by,
         creator.email as created_by_email
       FROM public.admin_profiles ap
       JOIN public.users u ON u.id = ap.user_id
       LEFT JOIN public.users creator ON creator.id = ap.created_by
       ${where}
       ORDER BY ap.created_at DESC`,
      values
    )

    // Attach permissions summary per user
    const userIds = rows.map((r: any) => r.user_id)
    let permsMap: Record<string, string[]> = {}
    if (userIds.length > 0) {
      const permRows = await pool.query(
        `SELECT user_id, module, action FROM public.admin_user_permissions WHERE user_id = ANY($1)`,
        [userIds]
      )
      for (const pr of permRows.rows) {
        if (!permsMap[pr.user_id]) permsMap[pr.user_id] = []
        permsMap[pr.user_id].push(`${pr.module}:${pr.action}`)
      }
    }

    const data = rows.map((r: any) => ({
      ...r,
      permissions: permsMap[r.user_id] ?? [],
    }))

    return NextResponse.json({ success: true, data })
  } catch (e) {
    return apiError(e, 'Failed to load admin accounts')
  }
}

/** POST /api/admin/users — create a new admin/user account */
export async function POST(req: Request) {
  try {
    const session = await requireSuperAdmin()
    const body = await req.json().catch(() => null)

    const { first_name, last_name, email, phone, password, admin_role, notes, permissions, preset } = body ?? {}

    if (!email?.trim()) return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 })
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 })
    }
    if (!['admin', 'user'].includes(admin_role)) {
      return NextResponse.json({ success: false, error: 'Role must be admin or user.' }, { status: 400 })
    }

    const pool = getDbPool()
    const normalEmail = email.trim().toLowerCase()

    // Check duplicate
    const existing = await pool.query(`SELECT id FROM public.users WHERE lower(email) = $1`, [normalEmail])
    if (existing.rows.length > 0) {
      return NextResponse.json({ success: false, error: 'An account with this email already exists.' }, { status: 409 })
    }

    const password_hash = await bcrypt.hash(password, 12)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Create user
      const { rows: [user] } = await client.query(
        `INSERT INTO public.users (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [normalEmail, password_hash]
      )

      // Create profile (role=admin so they can log in)
      await client.query(
        `INSERT INTO public.profiles (user_id, role) VALUES ($1, 'admin')`,
        [user.id]
      )

      // Create admin_profile
      await client.query(
        `INSERT INTO public.admin_profiles (user_id, first_name, last_name, phone, admin_role, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
        [user.id, first_name?.trim() ?? '', last_name?.trim() ?? '', phone?.trim() ?? null, admin_role, notes?.trim() ?? null, session.user_id]
      )

      // Determine permissions: explicit list, preset, or role default
      let grantedPerms: string[] = []
      if (Array.isArray(permissions) && permissions.length > 0) {
        grantedPerms = permissions
      } else if (preset) {
        const found = ROLE_PRESETS.find((p) => p.id === preset)
        if (found) grantedPerms = found.permissions
      }
      if (grantedPerms.length === 0) {
        // Default: copy role template
        const { rows: rolePerms } = await client.query(
          `SELECT p.module, p.action FROM public.role_permissions rp
           JOIN public.permissions p ON p.id = rp.permission_id
           JOIN public.roles r ON r.id = rp.role_id AND r.name = $1`,
          [admin_role]
        )
        grantedPerms = rolePerms.map((r: any) => `${r.module}:${r.action}`)
      }

      if (grantedPerms.length > 0) {
        const permValues = grantedPerms.map((key, idx) => {
          const [mod, act] = key.split(':')
          return `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`
        })
        const permArgs: unknown[] = grantedPerms.flatMap((key) => {
          const [mod, act] = key.split(':')
          return [user.id, mod, act]
        })
        await client.query(
          `INSERT INTO public.admin_user_permissions (user_id, module, action) VALUES ${permValues.join(',')} ON CONFLICT DO NOTHING`,
          permArgs
        )
      }

      await client.query('COMMIT')

      await writeAuditLog(pool, {
        ...actorFromSession(session),
        action: 'create_admin_account',
        module: 'admin_accounts',
        target_id: user.id,
        target_label: normalEmail,
        metadata: { admin_role, permissions_count: grantedPerms.length },
        ip_address: ipFromRequest(req),
      })

      return NextResponse.json({ success: true, data: { user_id: user.id, email: normalEmail, admin_role } }, { status: 201 })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    return apiError(e, 'Failed to create admin account')
  }
}
