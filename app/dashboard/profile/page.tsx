'use client'

import { User, Mail, Shield, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'

export default function AdminProfilePage() {
  const { session, loading, error } = useSession({ requireAuth: true })

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="page-container">
        <div className="flex items-center gap-3 p-6 bg-red-50 rounded-xl border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-700">{error ?? 'Failed to load account'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container max-w-2xl">
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-2">
          <User className="w-7 h-7 text-brand-600" />
          Profile
        </h1>
        <p className="page-subtitle">Your admin account details</p>
      </div>

      <div className="card divide-y divide-slate-100">
        <div className="p-5 flex items-start gap-4">
          <Mail className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Email</p>
            <p className="text-slate-900 font-medium mt-0.5">{session.email}</p>
          </div>
        </div>
        <div className="p-5 flex items-start gap-4">
          <Shield className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Role</p>
            <p className={cn('text-slate-900 font-medium mt-0.5 capitalize')}>{session.role}</p>
          </div>
        </div>
        <div className="p-5 flex items-start gap-4">
          <User className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">User ID</p>
            <p className="text-slate-600 text-sm font-mono mt-0.5 break-all">{session.user_id}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
