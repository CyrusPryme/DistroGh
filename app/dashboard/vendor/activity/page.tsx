'use client'

import Link from 'next/link'
import { ArrowLeft, Route } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { VendorActivityPanel } from '@/components/vendors/VendorActivityPanel'
import { useSession } from '@/hooks/useSession'

export default function VendorActivityPage() {
  useSession({ requireAuth: true, ensureVendorProfile: true })

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/dashboard/vendor"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>
      <PageHeader
        title="Product flow"
        description="Your products from warehouse receiving through store delivery and sales. Only your data is shown here."
        icon={<Route className="h-7 w-7 text-brand-600" />}
      />
      <VendorActivityPanel mode="vendor" />
    </div>
  )
}
