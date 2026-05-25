'use client'

import { useEffect, useState } from 'react'
import { HelpCircle, AlertCircle } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { vendorService } from '@/services/vendor.service'
import { ContactSupportPanel, type SupportContext } from '@/components/support/ContactSupportPanel'

export default function DashboardSupportPage() {
  const { session, loading: sessionLoading, isVendor, isAdmin, vendorId, email } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [context, setContext] = useState<SupportContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionLoading) return

    if (isAdmin && session) {
      setContext({
        label: 'Admin account',
        name: 'DistroGH Admin',
        email: session.email,
        roleLabel: 'Administrator',
      })
      setLoading(false)
      return
    }

    if (isVendor && vendorId) {
      vendorService
        .getById(vendorId)
        .then((v) => {
          if (!v) {
            setError('Vendor profile not found.')
            return
          }
          setContext({
            label: 'Vendor details',
            name: v.name,
            email: (v as { login_email?: string }).login_email ?? email ?? session?.email ?? '',
            phone: (v as { contact_phone?: string | null }).contact_phone ?? null,
            roleLabel: 'Vendor',
          })
        })
        .catch(() => setError('Failed to load vendor details'))
        .finally(() => setLoading(false))
      return
    }

    if (isVendor && !vendorId) {
      setError('No vendor linked to your account.')
    }
    setLoading(false)
  }, [sessionLoading, isAdmin, isVendor, vendorId, email, session])

  return (
    <div className="page-container max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 flex items-center gap-2">
          <HelpCircle className="w-7 h-7 text-emerald-600" />
          Contact support
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {isVendor
            ? 'Your vendor details are included automatically so we can respond quickly.'
            : 'Get help from the DistroGH team without leaving the dashboard.'}
        </p>
      </div>

      {error ? (
        <div className="data-card flex items-start gap-3 text-amber-800">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      ) : (
        <ContactSupportPanel context={context} loading={loading || sessionLoading} />
      )}
    </div>
  )
}
