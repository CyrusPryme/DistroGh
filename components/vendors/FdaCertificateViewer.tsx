'use client'

import { ExternalLink, FileText } from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'

type Props = {
  driveViewLink?: string | null
  /** Legacy local path only (pre-Drive uploads) */
  certificatePath?: string | null
  acquiredAt?: string | null
  expiresAt?: string | null
  className?: string
}

export function buildVendorDocumentUrl(storedPath: string): string {
  return `/api/vendor-documents/file?path=${encodeURIComponent(storedPath.trim())}`
}

export function FdaCertificateViewer({
  driveViewLink,
  certificatePath,
  acquiredAt,
  expiresAt,
  className,
}: Props) {
  const driveUrl = driveViewLink?.trim() || null
  const legacyUrl = !driveUrl && certificatePath?.trim()
    ? buildVendorDocumentUrl(certificatePath)
    : null
  const openUrl = driveUrl || legacyUrl

  if (!openUrl && !acquiredAt && !expiresAt) {
    return <p className={cn('text-sm text-slate-500', className)}>Not submitted yet</p>
  }

  return (
    <div className={cn('space-y-3', className)}>
      {(acquiredAt || expiresAt) && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {acquiredAt && (
            <div>
              <dt className="text-xs font-medium text-slate-500 mb-0.5">Date acquired</dt>
              <dd className="font-medium text-slate-800">{formatDate(acquiredAt)}</dd>
            </div>
          )}
          {expiresAt && (
            <div>
              <dt className="text-xs font-medium text-slate-500 mb-0.5">Facility expiry</dt>
              <dd className="font-medium text-slate-800">{formatDate(expiresAt)}</dd>
            </div>
          )}
        </dl>
      )}

      {openUrl ? (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          {driveUrl ? (
            <>
              <ExternalLink className="w-4 h-4" />
              Open in Google Drive
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              Open certificate
            </>
          )}
        </a>
      ) : (
        <p className="text-sm text-amber-700">Dates on file; certificate link unavailable.</p>
      )}
    </div>
  )
}
