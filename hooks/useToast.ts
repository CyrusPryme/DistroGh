import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastKind = 'success' | 'error'
export type ToastState = { message: string; type: ToastKind } | null

/**
 * Shared toast-state helper. Several pages previously reimplemented this with a bare
 * `setTimeout(() => setToast(null), n)` and no cleanup — if the page unmounted (or showed a
 * second toast) before the timer fired, it would call setState on a stale/unmounted
 * component and leak the timer. This tracks the pending timer and always clears it first.
 */
export function useToast(durationMs = 3500) {
  const [toast, setToast] = useState<ToastState>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setToast(null)
  }, [])

  const showToast = useCallback((message: string, type: ToastKind = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ message, type })
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setToast(null)
    }, durationMs)
  }, [durationMs])

  return { toast, showToast, dismissToast }
}
