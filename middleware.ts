import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getAuthSecret } from '@/lib/auth/config'

const isDev = process.env.NODE_ENV === 'development'

type Role = 'admin' | 'vendor'
type AdminRole = 'developer' | 'super_admin' | 'admin' | 'user'

interface SessionInfo {
  role: Role
  admin_role?: AdminRole | null
  permissions?: string[] | null
}

async function readSession(request: NextRequest): Promise<SessionInfo | null> {
  const token = request.cookies.get('session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getAuthSecret())
    const role = (payload as any)?.role
    if (role !== 'admin' && role !== 'vendor') return null
    const admin_role = (payload as any)?.admin_role ?? null
    const permissions = (payload as any)?.permissions ?? null
    return { role, admin_role, permissions }
  } catch {
    return null
  }
}

/** Check if the session has permission to access a given path. */
function isAdminPathAllowed(session: SessionInfo, pathname: string): boolean {
  // Developer gets everywhere
  if (session.admin_role === 'developer') return true

  // Platform Management is developer-only
  if (pathname.startsWith('/dashboard/platform')) return false

  // super_admin gets all remaining dashboard paths
  if (session.admin_role === 'super_admin') return true

  // Administration section is super_admin+ only
  if (pathname.startsWith('/dashboard/administration')) return false

  // Standard admin + user: allowed as long as role = 'admin'
  return true
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isPublicAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/)

  if (isPublicAsset) return NextResponse.next()

  const isRootPage = pathname === '/'
  const isLoginPage = pathname === '/login'
  const isProtectedRoute = pathname.startsWith('/dashboard')

  if (isRootPage) return NextResponse.next()

  const session = await readSession(request)
  if (isDev) console.log('🔐 SESSION:', { hasSession: !!session, role: session?.role, admin_role: session?.admin_role, pathname })

  if (isLoginPage) {
    if (session) return NextResponse.redirect(new URL('/dashboard', request.url))
    return NextResponse.next()
  }

  if (pathname === '/contact' && session) {
    return NextResponse.redirect(new URL('/dashboard/support', request.url))
  }

  if (isProtectedRoute) {
    if (!session) return NextResponse.redirect(new URL('/login', request.url))

    if (session.role === 'admin') {
      if (!isAdminPathAllowed(session, pathname)) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
      return NextResponse.next()
    }

    // vendor RBAC
    if (pathname === '/dashboard') {
      return NextResponse.redirect(new URL('/dashboard/vendor', request.url))
    }
    const vendorAllowed = [
      '/dashboard/vendor',
      '/dashboard/products',
      '/dashboard/sales',
      '/dashboard/returns',
      '/dashboard/receiving',
      '/dashboard/support',
    ]
    const allowed = vendorAllowed.some((p) => pathname === p || pathname.startsWith(p + '/'))
    if (allowed) return NextResponse.next()
    return NextResponse.redirect(new URL('/dashboard/sales', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/login',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
