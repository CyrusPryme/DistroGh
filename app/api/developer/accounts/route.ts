import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'

/** GET /api/developer/accounts — list all developer accounts */
export async function GET(req: Request) {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const url = new URL(req.url)
    const search = url.searchParams.get('search')?.trim() ?? ''

    const conditions = ["ap.admin_role = 'developer'"]
    const values: unknown[] = []
    let i = 1
    if (search) {
      conditions.push(`(lower(u.email) LIKE $${i} OR lower(ap.first_name) LIKE $${i} OR lower(ap.last_name) LIKE $${i})`)
      values.push(`%${search.toLowerCase()}%`)
      i++
    }

    const { rows } = await pool.query(
      `SELECT u.id as user_id, u.email, ap.first_name, ap.last_name, ap.phone,
              ap.admin_role, ap.status, ap.notes, ap.last_login_at, ap.created_at
       FROM public.admin_profiles ap
       JOIN public.users u ON u.id = ap.user_id
       WHERE ${conditions.join(' AND ')} AND ap.deleted_at IS NULL
       ORDER BY ap.created_at ASC`,
      values
    )

    // Load last IP from audit logs
    const userIds = rows.map((r: any) => r.user_id)
    let ipMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const ipRows = await pool.query(
        `SELECT DISTINCT ON (actor_id) actor_id, ip_address, created_at
         FROM public.audit_logs WHERE actor_id = ANY($1) AND action = 'login' AND ip_address IS NOT NULL
         ORDER BY actor_id, created_at DESC`,
        [userIds]
      )
      for (const r of ipRows.rows) ipMap[r.actor_id] = r.ip_address
    }

    const data = rows.map((r: any) => ({ ...r, last_ip: ipMap[r.user_id] ?? null }))
    return NextResponse.json({ success: true, data })
  } catch (e) {
    return apiError(e, 'Failed to load developer accounts')
  }
}

/** POST /api/developer/accounts — create developer account */
export async function POST(req: Request) {
  try {
    const session = await requireDeveloper()
    const body = await req.json().catch(() => null)
    const { first_name, last_name, email, phone, password, notes } = body ?? {}

    if (!email?.trim()) return NextResponse.json({ success: false, error: 'Email is required.' }, { status: 400 })
    if (!password || password.length < 8) return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 400 })

    const pool = getDbPool()
    const normalEmail = email.trim().toLowerCase()
    const existing = await pool.query(`SELECT id FROM public.users WHERE lower(email) = $1`, [normalEmail])
    if (existing.rows.length > 0) return NextResponse.json({ success: false, error: 'Email already exists.' }, { status: 409 })

    const password_hash = await bcrypt.hash(password, 12)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows: [user] } = await client.query(`INSERT INTO public.users (email, password_hash) VALUES ($1,$2) RETURNING id`, [normalEmail, password_hash])
      await client.query(`INSERT INTO public.profiles (user_id, role) VALUES ($1,'admin')`, [user.id])
      await client.query(
        `INSERT INTO public.admin_profiles (user_id, first_name, last_name, phone, admin_role, status, notes, created_by) VALUES ($1,$2,$3,$4,'developer','active',$5,$6)`,
        [user.id, first_name?.trim() ?? '', last_name?.trim() ?? '', phone?.trim() ?? null, notes?.trim() ?? null, session.user_id]
      )
      await client.query('COMMIT')
      await writeAuditLog(pool, { ...actorFromSession(session), action: 'create_developer_account', module: 'admin_accounts', target_id: user.id, target_label: normalEmail, ip_address: ipFromRequest(req) })
      return NextResponse.json({ success: true, data: { user_id: user.id, email: normalEmail } }, { status: 201 })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    return apiError(e, 'Failed to create developer account')
  }
}
