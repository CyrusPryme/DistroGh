'use client'

import { useEffect, useState } from 'react'
import { Route } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { VendorActivityPanel } from '@/components/vendors/VendorActivityPanel'
import { vendorService } from '@/services/vendor.service'
import { useSession } from '@/hooks/useSession'
import type { Vendor } from '@/types'

export default function AdminVendorActivityPage() {
  useSession({ redirectVendorFromAdmin: true })
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(true)

  useEffect(() => {
    vendorService
      .getAll()
      .then(setVendors)
      .catch(() => setVendors([]))
      .finally(() => setVendorsLoading(false))
  }, [])

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Vendor flow"
        description="Compare how much each vendor received at the warehouse, delivered to stores, sold, and returned — for any period."
        icon={<Route className="h-7 w-7 text-brand-600" />}
      />
      <VendorActivityPanel mode="admin" vendors={vendors} vendorsLoading={vendorsLoading} />
    </div>
  )
}
