'use client'

import Link from 'next/link'
import { ArrowLeft, ScrollText } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { ImportHistoryContent } from '@/components/sales/ImportHistoryContent'

export default function DataManagementImportHistoryPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/data-management"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Data Management
      </Link>

      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <ScrollText className="w-5 h-5 text-brand-700" />
          </div>
        }
        title="Sales Import History"
        description="Past monthly sales Excel imports — batches, row counts, and rollback"
      />

      <ImportHistoryContent
        importHref="/dashboard/sales/import"
        emptyCtaLabel="Go to Sales Import"
      />
    </div>
  )
}
