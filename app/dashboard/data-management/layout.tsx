'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  DatabaseBackup, History, CheckCircle2, AlertTriangle, FileSpreadsheet, ScrollText,
} from 'lucide-react'

const LINKS = [
  { href: '/dashboard/data-management', label: 'Overview', icon: DatabaseBackup },
  { href: '/dashboard/data-management/historical-migrations', label: 'Historical Migrations', icon: History },
  { href: '/dashboard/data-management/historical-migrations?status=importing', label: 'Active Migrations', icon: History },
  { href: '/dashboard/data-management/historical-migrations?status=completed', label: 'Completed', icon: CheckCircle2 },
  { href: '/dashboard/data-management/historical-migrations?status=failed', label: 'Failed', icon: AlertTriangle },
  { href: '/dashboard/data-management/templates', label: 'Migration Templates', icon: FileSpreadsheet },
  { href: '/dashboard/data-management/import-history', label: 'Sales Import History', icon: ScrollText },
]

export default function DataManagementLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ok, setOk] = useState(false)

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success || j.data?.role !== 'admin') {
          router.replace('/dashboard')
        } else {
          setOk(true)
        }
      })
      .catch(() => router.replace('/login'))
  }, [router])

  if (!ok) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh] text-slate-400">
        Verifying access…
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="flex flex-wrap gap-2 mb-2">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const base = href.split('?')[0]
          const active = pathname === base || (base !== '/dashboard/data-management' && pathname.startsWith(base))
          return (
            <Link
              key={href + label}
              href={href}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                active
                  ? 'bg-brand-50 border-brand-200 text-brand-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
