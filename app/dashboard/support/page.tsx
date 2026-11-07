'use client'

import { HelpCircle, AlertCircle } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useAsync } from '@/hooks/useAsync'
import { vendorService } from '@/services/vendor.service'
import { ContactSupportPanel, type SupportContext } from '@/components/support/ContactSupportPanel'

export default function DashboardSupportPage() {
  const { session, loading: sessionLoading, isVendor, isAdmin, vendorId, email } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })

  const { data: context, loading: dataLoading, error } = useAsync<SupportContext | null>(
    async () => {
      if (isAdmin && session) {
        return {
          label: 'Admin account',
          name: 'DistroGH Admin',
          email: session.email,
          roleLabel: 'Administrator',
        }
      }

      if (isVendor && vendorId) {
        let v
        try {
          v = await vendorService.getById(vendorId)
        } catch {
          throw new Error('Failed to load vendor details')
        }
        if (!v) throw new Error('Vendor profile not found.')
        return {
          label: 'Vendor details',
          name: v.name,
          email: (v as { login_email?: string }).login_email ?? email ?? session?.email ?? '',
          phone: (v as { contact_phone?: string | null }).contact_phone ?? null,
          roleLabel: 'Vendor',
        }
      }

      if (isVendor && !vendorId) {
        throw new Error('No vendor linked to your account.')
      }

      return null
    },
    [isAdmin, isVendor, vendorId, email, session],
    { enabled: !sessionLoading }
  )
  const loading = dataLoading || sessionLoading

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
