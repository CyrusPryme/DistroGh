'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ServiceChargeBanner as Banner } from '@/lib/vendor-service-charge'

export function ServiceChargeBanner({ banner }: { banner: Banner }) {
  const isRed = banner.variant === 'red'
  return (
    <div
      className={cn(
        'no-print shrink-0 px-4 py-3 sm:px-6 border-b flex items-start gap-3',
        isRed ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
      )}
      role="alert"
    >
      <AlertCircle
        className={cn('w-5 h-5 shrink-0 mt-0.5', isRed ? 'text-red-600' : 'text-amber-600')}
      />
      <div className="flex-1 min-w-0 text-sm">
        <p className={cn('font-semibold', isRed ? 'text-red-900' : 'text-amber-900')}>{banner.title}</p>
        <p className={cn('mt-0.5', isRed ? 'text-red-800' : 'text-amber-800')}>{banner.message}</p>
        <Link
          href="/dashboard/support"
          className={cn(
            'inline-block mt-2 font-medium underline underline-offset-2',
            isRed ? 'text-red-700 hover:text-red-900' : 'text-amber-800 hover:text-amber-950'
          )}
        >
          Contact support to renew
        </Link>
      </div>
    </div>
  )
}
