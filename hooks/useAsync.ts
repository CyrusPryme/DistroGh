'use client'

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export type UseAsyncResult<T> = {
  data: T | null
  loading: boolean
  error: string | null
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void
  /** Re-run the fetcher on demand (e.g. after a mutation, or a "Retry" button) without needing
   *  to change any dependency. */
  reload: () => void
}

/**
 * Runs an async fetcher on mount and whenever `deps` changes, guarding against a stale response
 * overwriting state from a newer request (or setting state after the component unmounts) via a
 * `cancelled` flag closure — the same pattern already used correctly in a handful of pages
 * (app/dashboard/receiving/page.tsx, app/dashboard/vendors/[id]/page.tsx,
 * app/dashboard/administration/audit-logs/page.tsx) but hand-rolled, inconsistently, or omitted
 * entirely across the other ~45 dashboard pages that each wrote their own
 * `useEffect(() => { load() }, [...])`. Centralizing it here means every page gets the same
 * correctness guarantee automatically, and the ~15 recurring
 * `react-hooks/exhaustive-deps` ("missing dependency: 'load'") lint warnings go away because
 * there's no more locally-defined `load` function being called out of a `useEffect`.
 *
 * Pass `enabled: false` to skip running the fetcher (e.g. while an upstream value like a
 * vendorId from useSession() is still loading) — `loading` stays false and `data`/`error` are
 * left untouched until `enabled` flips true.
 *
 * Usage:
 *   const { data, loading, error, reload } = useAsync(
 *     () => vendorService.getVendorStatement(vendorId!, from, to),
 *     [vendorId, from, to],
 *     { enabled: !!vendorId }
 *   )
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  options: { enabled?: boolean } = {}
): UseAsyncResult<T> {
  const { enabled = true } = options
  const [data, setDataState] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Keep the latest fetcher without forcing callers to useCallback() it themselves — deps alone
  // (caller-supplied, mirroring the hand-rolled useEffect(load, deps) pattern this replaces)
  // control when a new fetch actually runs.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const reload = useCallback(() => setReloadToken((t) => t + 1), [])

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (prev: T | null) => T | null)(prev) : updater))
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    // Setting loading/error synchronously here (rather than only inside the async callback) is
    // the standard shape for a fetch-on-deps-change hook — without it, a reload triggered by a
    // deps change wouldn't flip loading back to true until the previous data is already stale on
    // screen. Centralized here instead of repeated (unjustified) across 45 call sites.
    setLoading(true)
    setError(null)
    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) setDataState(result)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken, enabled])

  return { data, loading, error, setData, reload }
}
