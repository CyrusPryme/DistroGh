import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { createSessionCookie, type SessionRole } from '@/lib/auth/session'
import { writeAuditLog } from '@/lib/rbac/audit'
import { ipFromRequest } from '@/lib/rbac/audit'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const email = (body?.email ?? '').toString().trim().toLowerCase()
    const password = (body?.password ?? '').toString()

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password are required.' }, { status: 400 })
    }

    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select
        u.id as user_id,
        u.password_hash,
        p.role,
        p.vendor_id,
        ap.admin_role,
        ap.status  as admin_status,
        ap.first_name,
        ap.last_name
      from public.users u
      left join public.profiles p on p.user_id = u.id
      left join public.admin_profiles ap on ap.user_id = u.id
      where lower(u.email) = $1
      limit 1
      `,
      [email]
    )

    const row = rows[0]
    if (!row) {
      return NextResponse.json({ success: false, error: 'Invalid email or password.' }, { status: 401 })
    }

    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Invalid email or password.' }, { status: 401 })
    }

    const role = (row.role ?? 'admin') as SessionRole
    if (role !== 'admin' && role !== 'vendor') {
      return NextResponse.json({ success: false, error: 'Account role is invalid.' }, { status: 403 })
    }

    // Check admin suspension (developer accounts cannot be suspended)
    if (role === 'admin' && row.admin_status === 'suspended' && row.admin_role !== 'developer') {
      return NextResponse.json({ success: false, error: 'Your account has been suspended. Contact your administrator.' }, { status: 403 })
    }

    const admin_role = row.admin_role ?? null
    let permissions: string[] | null = null
    let display_name: string | null = null

    if (role === 'admin') {
      display_name =
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null

      if (admin_role === 'super_admin') {
        // super_admin bypasses permission checks; store empty array (all implicit)
        permissions = []
      } else {
        // Load per-user permissions from admin_user_permissions
        const permRows = await pool.query(
          `SELECT module, action FROM public.admin_user_permissions WHERE user_id = $1`,
          [row.user_id]
        )
        permissions = permRows.rows.map((r: { module: string; action: string }) => `${r.module}:${r.action}`)

        // Auto-provision: if no permissions recorded yet, copy role defaults
        if (permissions.length === 0 && admin_role) {
          await pool.query(
            `INSERT INTO public.admin_user_permissions (user_id, module, action)
             SELECT $1, p.module, p.action
             FROM public.role_permissions rp
             JOIN public.permissions p ON p.id = rp.permission_id
             JOIN public.roles r ON r.id = rp.role_id AND r.name = $2
             ON CONFLICT (user_id, module, action) DO NOTHING`,
            [row.user_id, admin_role]
          )
          const reprovRows = await pool.query(
            `SELECT module, action FROM public.admin_user_permissions WHERE user_id = $1`,
            [row.user_id]
          )
          permissions = reprovRows.rows.map((r: { module: string; action: string }) => `${r.module}:${r.action}`)
        }
      }
    }

    // Update last_login_at for admin profiles
    if (role === 'admin' && row.admin_role !== null) {
      await pool.query(
        `UPDATE public.admin_profiles SET last_login_at = now() WHERE user_id = $1`,
        [row.user_id]
      ).catch(() => {})
    } else if (role === 'admin') {
      // Ensure admin_profile exists for legacy admin users (lazy provisioning)
      await pool.query(
        `INSERT INTO public.admin_profiles (user_id, admin_role, status, last_login_at)
         VALUES ($1, 'admin', 'active', now())
         ON CONFLICT (user_id) DO UPDATE SET last_login_at = now()`,
        [row.user_id]
      ).catch(() => {})
    }

    await createSessionCookie({
      user_id: row.user_id,
      email,
      role,
      vendor_id: row.vendor_id ?? null,
      admin_role,
      permissions,
      display_name,
    })

    // Audit login
    await writeAuditLog(pool, {
      actor_id: row.user_id,
      actor_email: email,
      action: 'login',
      module: 'auth',
      ip_address: ipFromRequest(req),
    })

    return NextResponse.json({ success: true, role, admin_role, vendor_id: row.vendor_id ?? null })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'Login failed.' }, { status: 500 })
  }
}
