'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Crown } from 'lucide-react'

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!j?.success || j.data?.admin_role !== 'developer') {
          router.replace('/dashboard')
        } else {
          setChecking(false)
        }
      })
      .catch(() => router.replace('/login'))
  }, [router])

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
        <Crown className="w-6 h-6 mr-2 animate-pulse" /> Verifying developer access…
      </div>
    )
  }

  return <>{children}</>
}
