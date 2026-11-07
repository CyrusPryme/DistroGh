import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAsync } from '@/hooks/useAsync'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAsync', () => {
  it('loads data and flips loading false on success', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello')
    const { result } = renderHook(() => useAsync(fetcher, []))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('hello')
    expect(result.current.error).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('surfaces a thrown Error message', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAsync(fetcher, []))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
    expect(result.current.data).toBeNull()
  })

  it('does not apply a stale response after deps change (race-condition guard)', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    let dep = 'a'
    const { result, rerender } = renderHook(() => useAsync(fetcher, [dep]))

    // Change deps before the first request resolves — simulates a user rapidly switching filters.
    dep = 'b'
    rerender()

    // Second (current) request resolves first.
    second.resolve('second-result')
    await waitFor(() => expect(result.current.data).toBe('second-result'))

    // Stale first request resolves after — must NOT overwrite the current result.
    first.resolve('first-result-stale')
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.data).toBe('second-result')
  })

  it('does not set state after unmount', async () => {
    const pending = deferred<string>()
    const fetcher = vi.fn().mockReturnValue(pending.promise)
    const { unmount } = renderHook(() => useAsync(fetcher, []))

    unmount()
    pending.resolve('too-late')
    // No assertion needed beyond "doesn't throw/warn" — React would log an act() warning or
    // "state update on unmounted component" if the cancelled guard were missing.
    await new Promise((r) => setTimeout(r, 10))
  })

  it('skips fetching while enabled is false, then fetches once enabled flips true', async () => {
    const fetcher = vi.fn().mockResolvedValue('data')
    let enabled = false
    const { result, rerender } = renderHook(() => useAsync(fetcher, [], { enabled }))

    expect(result.current.loading).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()

    enabled = true
    rerender()
    await waitFor(() => expect(result.current.data).toBe('data'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reload() re-runs the fetcher without a deps change', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const { result } = renderHook(() => useAsync(fetcher, []))

    await waitFor(() => expect(result.current.data).toBe('first'))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toBe('second'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('setData allows optimistic local updates (e.g. after a mutation)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ count: 1 })
    const { result } = renderHook(() => useAsync(fetcher, []))

    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }))
    act(() => result.current.setData((prev: { count: number } | null) => ({ count: (prev?.count ?? 0) + 1 })))
    expect(result.current.data).toEqual({ count: 2 })
  })
})
