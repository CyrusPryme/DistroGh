'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ServiceChargeBanner as ServiceChargeBannerData } from '@/lib/vendor-service-charge'

export type MeServiceCharge = {
  payment_status: string
  lifecycle: string
  paid_at: string | null
  expires_at: string | null
  suspended_reason: string | null
  banner: ServiceChargeBannerData | null
}

/** Raw shape of a successful `/api/me` response's `data` field. */
export type MeData = {
  user_id: string
  email: string
  role: 'admin' | 'vendor'
  vendor_id: string | null
  admin_role: string | null
  permissions: string[] | null
  display_name: string | null
  service_charge: MeServiceCharge | null
}

type SessionContextValue = {
  /** Raw /api/me payload. Null while loading, or when unauthenticated. */
  data: MeData | null
  loading: boolean
  error: string | null
  /** Re-fetches /api/me and updates every consumer. Call after login/logout/profile edits. */
  refresh: () => Promise<MeData | null>
}

const SessionContext = createContext<SessionContextValue | null>(null)

async function fetchMe(): Promise<MeData | null> {
  const res = await fetch('/api/me', { cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success || !json.data) return null
  return json.data as MeData
}

/**
 * Fetches `/api/me` exactly once per app load and shares the result via context.
 *
 * Before this, every dashboard navigation fired several redundant `/api/me` round trips:
 * `AppLayout` fetched it for the sidebar, section layouts (`PlatformLayout`,
 * `AdministrationLayout`, `DataManagementLayout`) each fetched it again for their own role gate,
 * and the page itself fetched it a third time via `useSession()` — all for identical data.
 * Mounted once in the root layout (`app/layout.tsx`) so it persists across client-side
 * navigations instead of re-fetching per route.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<MeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await fetchMe()
      setData(me)
      return me
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session')
      setData(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    // Intentionally run once on mount only — call `refresh()` explicitly after actions that
    // change the session (login, logout, profile updates) instead of re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SessionContext.Provider value={{ data, loading, error, refresh }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSessionContext must be used within <SessionProvider>')
  }
  return ctx
}
