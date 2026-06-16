import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { getAuthSecret } from '@/lib/auth/config'
import type { AdminRole } from '@/lib/auth/permissions'

const COOKIE_NAME = 'session'

export type SessionRole = 'admin' | 'vendor'

export interface SessionPayload {
  user_id: string
  email: string
  role: SessionRole
  vendor_id?: string | null
  /** Granular admin sub-role (only present for admin-type users) */
  admin_role?: AdminRole | null
  /** Compact permission keys: "module:action". Empty for super_admin (all implicit). */
  permissions?: string[] | null
  /** Display name from admin_profiles */
  display_name?: string | null
}

// `jose` requires the payload to be a record-like object (JWTPayload).
// This type satisfies that without weakening our fields.
type JwtPayloadCompat = SessionPayload & Record<string, unknown>

export async function createSessionCookie(payload: SessionPayload) {
  const token = await new SignJWT(payload as JwtPayloadCompat)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getAuthSecret())

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

export async function readSessionCookie(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getAuthSecret())
    if (typeof payload !== 'object' || !payload) return null
    const user_id = (payload as any).user_id
    const email = (payload as any).email
    const role = (payload as any).role
    const vendor_id = (payload as any).vendor_id ?? null
    const admin_role = (payload as any).admin_role ?? null
    const permissions = (payload as any).permissions ?? null
    const display_name = (payload as any).display_name ?? null
    if (typeof user_id !== 'string') return null
    if (typeof email !== 'string') return null
    if (role !== 'admin' && role !== 'vendor') return null
    return { user_id, email, role, vendor_id, admin_role, permissions, display_name }
  } catch {
    return null
  }
}

