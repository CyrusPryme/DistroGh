'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Shield } from 'lucide-react'
import { useSessionContext } from '@/lib/client/session-context'

export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data, loading } = useSessionContext()
  const role = data?.admin_role
  const authorized = !loading && (role === 'super_admin' || role === 'developer')

  useEffect(() => {
    if (loading) return
    if (!data || (role !== 'super_admin' && role !== 'developer')) {
      router.replace('/dashboard')
    }
  }, [loading, data, role, router])

  if (loading || !authorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
        <Shield className="w-6 h-6 mr-2 animate-pulse" /> Verifying access…
      </div>
    )
  }

  return <>{children}</>
}
