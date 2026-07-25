'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/PageHeader'
import { FileSpreadsheet } from 'lucide-react'

type Template = {
  entity_type: string
  label: string
  description: string
  required_columns: string[]
  optional_columns: string[]
  sample_rows: Record<string, unknown>[]
}

export default function MigrationTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])

  useEffect(() => {
    fetch('/api/migrations/templates')
      .then((r) => r.json())
      .then((j) => { if (j.success) setTemplates(j.data) })
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-brand-700" />
          </div>
        }
        title="Migration Templates"
        description="Column contracts for each historical entity. Download layouts are described here for spreadsheet preparation."
      />

      <div className="space-y-4">
        {templates.map((t) => (
          <div key={t.entity_type} className="data-card">
            <h2 className="font-semibold text-slate-900">{t.label}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{t.description}</p>
            <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <p className="font-semibold text-slate-600 mb-1">Required</p>
                <p className="text-slate-700">{(t.required_columns || []).join(', ') || '—'}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1">Optional</p>
                <p className="text-slate-700">{(t.optional_columns || []).join(', ') || '—'}</p>
              </div>
            </div>
            {t.sample_rows?.[0] && (
              <pre className="mt-3 text-xs bg-slate-50 rounded-lg p-3 overflow-x-auto text-slate-600">
                {JSON.stringify(t.sample_rows[0], null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
