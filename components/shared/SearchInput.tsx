'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

function shortcutHint(): string {
  if (typeof navigator === 'undefined') return '/'
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  return isMac ? '⌘K' : 'Ctrl K'
}

type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  enableShortcut?: boolean
  'aria-label'?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  inputClassName,
  enableShortcut = true,
  'aria-label': ariaLabel = 'Search',
}: SearchInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [hint, setHint] = useState('/')

  useEffect(() => {
    setHint(shortcutHint())
  }, [])

  useEffect(() => {
    if (!enableShortcut) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable

      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !inField) {
        e.preventDefault()
        ref.current?.focus()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enableShortcut])

  return (
    <div className={cn('relative w-full max-w-md', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('form-input w-full pl-10 pr-20', inputClassName)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              ref.current?.focus()
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : enableShortcut ? (
          <kbd className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
            {hint}
          </kbd>
        ) : null}
      </div>
    </div>
  )
}
