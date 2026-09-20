'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Crown } from 'lucide-react'
import { useSessionContext } from '@/lib/client/session-context'

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data, loading } = useSessionContext()
  const checking = loading || !data
  const authorized = !loading && data?.admin_role === 'developer'

  useEffect(() => {
    if (loading) return
    if (!data) {
      router.replace('/login')
    } else if (data.admin_role !== 'developer') {
      router.replace('/dashboard')
    }
  }, [loading, data, router])

  if (checking || !authorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
        <Crown className="w-6 h-6 mr-2 animate-pulse" /> Verifying developer access…
      </div>
    )
  }

  return <>{children}</>
}
