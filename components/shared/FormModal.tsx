'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FormModalProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  maxWidthClass?: string
  disableBackdropClose?: boolean
  children: React.ReactNode
}

export function FormModal({
  open,
  onClose,
  title,
  description,
  maxWidthClass = 'max-w-md',
  disableBackdropClose = false,
  children,
}: FormModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={disableBackdropClose ? undefined : onClose}
        aria-hidden
      />
      <div
        className={cn(
          'relative bg-white rounded-2xl shadow-modal w-full max-h-[min(90vh,720px)] flex flex-col animate-slide-up overflow-hidden my-auto',
          maxWidthClass
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 id="form-modal-title" className="font-display font-semibold text-slate-900">
              {title}
            </h2>
            {description ? (
              <p className="text-xs text-slate-400 mt-0.5">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={disableBackdropClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function FormModalBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0', className)}>
      {children}
    </div>
  )
}

export function FormModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-3 bg-white">
      {children}
    </div>
  )
}

