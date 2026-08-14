'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'dg-table-density'
const CHANGE_EVENT = 'dg-density-change'

export type TableDensity = 'comfortable' | 'compact'

function readDensity(): TableDensity {
  if (typeof window === 'undefined') return 'comfortable'
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function applyToDocument(density: TableDensity) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-density', density)
}

/**
 * Global "comfortable vs compact" row-density preference for every .data-table on the page —
 * unlike per-table page size, density is a personal display preference a user expects to apply
 * everywhere at once (same idea as Gmail's density setting), so it's one shared value applied via
 * a `data-density` attribute on <html> (see globals.css) rather than per-table state.
 *
 * Multiple components can call this hook at once (e.g. a page with several tables, each rendering
 * its own PaginationBar) — they all read/write the same localStorage key and stay in sync via a
 * custom window event, plus the native `storage` event for syncing across browser tabs.
 */
export function useDensity(): [TableDensity, (d: TableDensity) => void] {
  const [density, setDensityState] = useState<TableDensity>(readDensity)

  useEffect(() => {
    applyToDocument(density)
  }, [density])

  useEffect(() => {
    const sync = () => setDensityState(readDensity())
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setDensity = useCallback((d: TableDensity) => {
    setDensityState(d)
    try {
      window.localStorage.setItem(STORAGE_KEY, d)
    } catch {
      // ignore — density still applies for this session via in-memory state
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return [density, setDensity]
}
