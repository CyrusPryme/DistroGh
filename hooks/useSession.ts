'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchClientSession, type ClientSession } from '@/lib/client/session'

type UseSessionOptions = {
  /** Redirect to /login when not authenticated */
  requireAuth?: boolean
  /** Redirect vendors to /dashboard/vendor */
  redirectVendorFromAdmin?: boolean
  /** Link vendor profile by email when vendor_id is missing */
  ensureVendorProfile?: boolean
}

export function useSession(options: UseSessionOptions = {}) {
  const router = useRouter()
  const [session, setSession] = useState<ClientSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSession = useCallback(async (): Promise<ClientSession | null> => {
    let s = await fetchClientSession()
    if (s?.role === 'vendor' && !s.vendor_id && options.ensureVendorProfile) {
      const { ensureVendorProfileByEmail } = await import('@/app/dashboard/vendor/ensure-profile')
      await ensureVendorProfileByEmail()
      s = await fetchClientSession()
    }
    return s
  }, [options.ensureVendorProfile])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const s = await loadSession()
      setSession(s)
      if (!s && options.requireAuth) router.replace('/login')
      if (s && options.redirectVendorFromAdmin && s.role === 'vendor') {
        router.replace('/dashboard/vendor')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
    } finally {
      setLoading(false)
    }
  }, [loadSession, options.requireAuth, options.redirectVendorFromAdmin, router])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const s = await loadSession()
        if (cancelled) return
        if (!s) {
          setSession(null)
          if (options.requireAuth) router.replace('/login')
          return
        }
        setSession(s)
        if (options.redirectVendorFromAdmin && s.role === 'vendor') {
          router.replace('/dashboard/vendor')
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load session')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [loadSession, router, options.requireAuth, options.redirectVendorFromAdmin])

  return {
    session,
    loading,
    error,
    refresh,
    role: session?.role ?? null,
    vendorId: session?.vendor_id ?? null,
    email: session?.email ?? '',
    isAdmin: session?.role === 'admin',
    isVendor: session?.role === 'vendor',
  }
}
