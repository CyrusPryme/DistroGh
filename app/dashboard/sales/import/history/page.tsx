'use client'

import { PageHeader } from '@/components/shared/PageHeader'
import { ImportHistoryContent } from '@/components/sales/ImportHistoryContent'
import { ScrollText } from 'lucide-react'

export default function ImportHistoryPage() {
  return (
    <div className="page-container space-y-6">
      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <ScrollText className="w-5 h-5 text-brand-700" />
          </div>
        }
        title="Import History"
        description="Manage your recent sales imports"
      />

      <ImportHistoryContent />
    </div>
  )
}
