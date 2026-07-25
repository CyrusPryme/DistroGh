'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/PageHeader'
import { DatabaseBackup, Plus, History, FileSpreadsheet } from 'lucide-react'

type Migration = {
  id: string
  name: string
  status: string
  progress_pct: number
  current_stage: number
  last_activity_at: string
}

export default function DataManagementOverviewPage() {
  const [items, setItems] = useState<Migration[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/migrations')
      .then((r) => r.json())
      .then((j) => { if (j.success) setItems(j.data) })
      .finally(() => setLoading(false))
  }, [])

  const active = items.filter((m) => ['draft','analysing','awaiting_correction','ready','approved','importing','paused','verifying'].includes(m.status))
  const completed = items.filter((m) => m.status === 'completed')
  const failed = items.filter((m) => m.status === 'failed' || m.status === 'rolled_back')

  return (
    <div className="space-y-6">
      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <DatabaseBackup className="w-5 h-5 text-brand-700" />
          </div>
        }
        title="Data Management"
        description="Enterprise historical data migration centre — durable, staged, recoverable"
        actions={
          <Link href="/dashboard/data-management/historical-migrations?new=1" className="btn-primary">
            <Plus className="w-4 h-4" />
            New Migration
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total projects', value: loading ? '…' : String(items.length) },
          { label: 'Active', value: loading ? '…' : String(active.length) },
          { label: 'Completed', value: loading ? '…' : String(completed.length) },
          { label: 'Failed / rolled back', value: loading ? '…' : String(failed.length) },
        ].map((k) => (
          <div key={k.label} className="kpi-card text-center !p-4">
            <p className="text-2xl font-bold text-slate-800">{k.value}</p>
            <p className="text-xs text-slate-500 mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Link href="/dashboard/data-management/historical-migrations" className="data-card hover:shadow-card-hover transition-shadow">
          <History className="w-5 h-5 text-brand-600 mb-2" />
          <p className="font-semibold text-slate-900">Historical Migrations</p>
          <p className="text-xs text-slate-500 mt-1">Create, resume, and monitor migration projects</p>
        </Link>
        <Link href="/dashboard/data-management/templates" className="data-card hover:shadow-card-hover transition-shadow">
          <FileSpreadsheet className="w-5 h-5 text-brand-600 mb-2" />
          <p className="font-semibold text-slate-900">Migration Templates</p>
          <p className="text-xs text-slate-500 mt-1">Required columns and sample layouts per entity</p>
        </Link>
        <Link href="/dashboard/sales/import" className="data-card hover:shadow-card-hover transition-shadow">
          <FileSpreadsheet className="w-5 h-5 text-slate-600 mb-2" />
          <p className="font-semibold text-slate-900">Monthly Sales Import</p>
          <p className="text-xs text-slate-500 mt-1">Existing correction UI for day-to-day Excel sales</p>
        </Link>
      </div>
    </div>
  )
}
