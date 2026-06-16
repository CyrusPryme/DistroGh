'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PageToastProps = {
  message: string | null
  type?: 'success' | 'error'
  onDismiss?: () => void
}

/** Fixed toast rendered above modals (z-[100]) via portal. */
export function PageToast({ message, type = 'success', onDismiss }: PageToastProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!message || !mounted) return null

  return createPortal(
    <div
      role="alert"
      className={cn(
        'fixed top-4 right-4 z-[100] flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-modal animate-slide-up',
        type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
      )}
    >
      <span className="flex-1">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 hover:bg-white/20"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>,
    document.body
  )
}
