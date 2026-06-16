import { NextResponse } from 'next/server'
import { clearSessionCookie, readSessionCookie } from '@/lib/auth/session'
import { getDbPool } from '@/lib/db'
import { writeAuditLog } from '@/lib/rbac/audit'

export async function POST(req: Request) {
  try {
    const session = await readSessionCookie()
    await clearSessionCookie()

    if (session) {
      const pool = getDbPool()
      const fwd = req.headers.get('x-forwarded-for')
      const ip = fwd ? fwd.split(',')[0].trim() : null
      await writeAuditLog(pool, {
        actor_id: session.user_id,
        actor_email: session.email,
        action: 'logout',
        module: 'auth',
        ip_address: ip,
      })
    }
  } catch {
    // Errors must not block logout
  }

  return NextResponse.json({ success: true })
}
