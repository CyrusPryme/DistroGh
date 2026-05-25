'use client'

import { useMemo, useState } from 'react'
import { FileText, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  certificatePath: string | null | undefined
  className?: string
  /** When true, preview is shown immediately (for admin review). */
  defaultExpanded?: boolean
}

function extensionFromPath(storedPath: string): string {
  const i = storedPath.lastIndexOf('.')
  return i >= 0 ? storedPath.slice(i).toLowerCase() : ''
}

export function buildVendorDocumentUrl(storedPath: string): string {
  return `/api/vendor-documents/file?path=${encodeURIComponent(storedPath.trim())}`
}

export function FdaCertificateViewer({
  certificatePath,
  className,
  defaultExpanded = true,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loadError, setLoadError] = useState(false)

  const preview = useMemo(() => {
    if (!certificatePath?.trim()) return null
    const url = buildVendorDocumentUrl(certificatePath)
    const ext = extensionFromPath(certificatePath)
    const isPdf = ext === '.pdf'
    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
    return { url, isPdf, isImage }
  }, [certificatePath])

  if (!preview) {
    return <p className={cn('text-sm text-slate-500', className)}>Not submitted yet</p>
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setLoadError(false)
            setExpanded((v) => !v)
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          <FileText className="w-4 h-4" />
          {expanded ? 'Hide preview' : 'View certificate'}
        </button>
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          Open in new tab
        </a>
      </div>

      {expanded && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
          {loadError ? (
            <div className="flex items-start gap-2 p-4 text-amber-800 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Could not load this file for preview. It may be missing on the server (e.g. demo placeholder path).
                Try opening in a new tab or ask the vendor to re-upload.
              </p>
            </div>
          ) : preview.isPdf ? (
            <iframe
              src={preview.url}
              title="FDA certificate"
              className="w-full h-[min(70vh,560px)] bg-white"
            />
          ) : preview.isImage ? (
            <div className="flex justify-center p-3 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.url}
                alt="FDA certificate"
                className="max-w-full max-h-[min(70vh,560px)] object-contain"
                onError={() => setLoadError(true)}
              />
            </div>
          ) : (
            <div className="p-4 text-sm text-slate-600">
              Inline preview is not available for this file type.{' '}
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline">
                Open file
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
