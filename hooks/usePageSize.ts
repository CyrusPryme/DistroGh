'use client'

import { useCallback, useState } from 'react'
import { DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'

const STORAGE_PREFIX = 'dg-table-page-size:'

function readStoredPageSize(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + key)
    if (stored === null) return fallback
    const parsed = Number(stored)
    // ALL_PAGE_SIZE (-1) and any positive size are both valid; anything else falls back
    return Number.isFinite(parsed) && (parsed > 0 || parsed === -1) ? parsed : fallback
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.) — use the default
    return fallback
  }
}

/**
 * Persists a table's "rows per page" choice per table (keyed by `key`) in localStorage, so each
 * table across the app remembers its own preferred density independently — mirrors how Gmail/Jira
 * remember page size per view instead of one global setting.
 */
export function usePageSize(key: string, defaultSize: number = DEFAULT_PAGE_SIZE): [number, (size: number) => void] {
  const [pageSize, setPageSizeState] = useState(() => readStoredPageSize(key, defaultSize))

  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(size)
      try {
        window.localStorage.setItem(STORAGE_PREFIX + key, String(size))
      } catch {
        // ignore write failures — the in-memory state still updates for this session
      }
    },
    [key]
  )

  return [pageSize, setPageSize]
}
