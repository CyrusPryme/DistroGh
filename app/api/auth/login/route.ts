import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { createSessionCookie, type SessionRole } from '@/lib/auth/session'

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
        p.vendor_id
      from public.users u
      left join public.profiles p on p.user_id = u.id
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

    await createSessionCookie({
      user_id: row.user_id,
      email,
      role,
      vendor_id: row.vendor_id ?? null,
    })

    return NextResponse.json({ success: true, role, vendor_id: row.vendor_id ?? null })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'Login failed.' }, { status: 500 })
  }
}

