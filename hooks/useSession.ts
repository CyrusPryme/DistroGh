'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSessionContext, type MeData } from '@/lib/client/session-context'
import type { ClientSession } from '@/lib/client/session'

export type { ClientSession }

type UseSessionOptions = {
  /** Redirect to /login when not authenticated */
  requireAuth?: boolean
  /** Redirect vendors to /dashboard/vendor */
  redirectVendorFromAdmin?: boolean
  /** Link vendor profile by email when vendor_id is missing */
  ensureVendorProfile?: boolean
}

function toClientSession(data: MeData | null): ClientSession | null {
  if (!data) return null
  return {
    user_id: String(data.user_id ?? ''),
    email: String(data.email ?? ''),
    role: data.role === 'vendor' ? 'vendor' : 'admin',
    vendor_id: data.vendor_id ?? null,
  }
}

/**
 * Reads the app-wide session fetched once by `<SessionProvider>` (see
 * `lib/client/session-context.tsx`) instead of hitting `/api/me` itself — this hook used to
 * fetch independently on every page that called it, which is why loading a single dashboard
 * page could trigger 3-4 redundant `/api/me` requests (this hook + AppLayout + a section
 * layout's own role gate, all wanting the same data).
 */
export function useSession(options: UseSessionOptions = {}) {
  const router = useRouter()
  const { data, loading: contextLoading, error: contextError, refresh } = useSessionContext()
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  const repairAttempted = useRef(false)

  const session = toClientSession(data)
  const loading = contextLoading || repairing

  // One-time repair: link a vendor session to its vendor profile by email if missing.
  useEffect(() => {
    if (contextLoading || repairAttempted.current) return
    if (session?.role === 'vendor' && !session.vendor_id && options.ensureVendorProfile) {
      repairAttempted.current = true
      setRepairing(true)
      ;(async () => {
        try {
          const { ensureVendorProfileByEmail } = await import('@/app/dashboard/vendor/ensure-profile')
          await ensureVendorProfileByEmail()
          await refresh()
        } catch (e) {
          setRepairError(e instanceof Error ? e.message : 'Failed to load session')
        } finally {
          setRepairing(false)
        }
      })()
    }
  }, [contextLoading, session, options.ensureVendorProfile, refresh])

  // Redirects once the (possibly repaired) session has settled.
  useEffect(() => {
    if (loading) return
    if (!session) {
      if (options.requireAuth) router.replace('/login')
      return
    }
    if (options.redirectVendorFromAdmin && session.role === 'vendor') {
      router.replace('/dashboard/vendor')
    }
  }, [session, loading, options.requireAuth, options.redirectVendorFromAdmin, router])

  return {
    session,
    loading,
    error: repairError ?? contextError,
    refresh,
    role: session?.role ?? null,
    vendorId: session?.vendor_id ?? null,
    email: session?.email ?? '',
    isAdmin: session?.role === 'admin',
    isVendor: session?.role === 'vendor',
  }
}
