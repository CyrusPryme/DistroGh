'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const role = j?.data?.admin_role
        if (!j?.success || (role !== 'super_admin' && role !== 'developer')) {
          router.replace('/dashboard')
        } else {
          setChecking(false)
        }
      })
      .catch(() => router.replace('/dashboard'))
  }, [router])

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
        <Shield className="w-6 h-6 mr-2 animate-pulse" /> Verifying access…
      </div>
    )
  }

  return <>{children}</>
}
