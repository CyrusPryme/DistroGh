import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getAuthSecret } from '@/lib/auth/config'

const isDev = process.env.NODE_ENV === 'development'

type Role = 'admin' | 'vendor'

async function readSession(request: NextRequest): Promise<{ role: Role } | null> {
  const token = request.cookies.get('session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getAuthSecret())
    const role = (payload as any)?.role
    if (role !== 'admin' && role !== 'vendor') return null
    return { role }
  } catch {
    return null
  }
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
  if (isDev) console.log('🔐 SESSION:', { hasSession: !!session, role: session?.role, pathname })

  if (isLoginPage) {
    if (session) return NextResponse.redirect(new URL('/dashboard', request.url))
    return NextResponse.next()
  }

  if (pathname === '/contact' && session) {
    return NextResponse.redirect(new URL('/dashboard/support', request.url))
  }

  if (isProtectedRoute) {
    if (!session) return NextResponse.redirect(new URL('/login', request.url))

    if (session.role === 'admin') return NextResponse.next()

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