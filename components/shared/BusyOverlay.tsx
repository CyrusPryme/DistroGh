'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'

export type BusyOverlayProps = {
  active: boolean
  label?: string
  sublabel?: string
}

const noopSubscribe = () => () => {}

/** True once hydrated on the client — avoids portalling before `document` exists. */
function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
}

/**
 * Full-page blocking overlay for actions that write data (approve, import,
 * cancel, delete, upload). Blurs and dims the page, disables interaction,
 * and shows a spinner so the admin knows the system is working and doesn't
 * double-click or think the app is frozen.
 */
export function BusyOverlay({ active, label = 'Working…', sublabel }: BusyOverlayProps) {
  const mounted = useIsClient()
  if (!active || !mounted) return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-white/50 backdrop-blur-sm animate-fade-in"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-8 py-6 shadow-modal border border-slate-100">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">{label}</p>
          {sublabel && <p className="text-xs text-slate-500 mt-1 max-w-xs">{sublabel}</p>}
        </div>
      </div>
    </div>,
    document.body
  )
}
