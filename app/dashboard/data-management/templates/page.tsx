'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/PageHeader'
import { FileSpreadsheet, Download } from 'lucide-react'

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
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/migrations/templates')
      .then((r) => r.json())
      .then((j) => { if (j.success) setTemplates(j.data) })
  }, [])

  const download = async (url: string, key: string) => {
    setDownloading(key)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] || 'migration-template.xlsx'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      alert('Could not download template. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-brand-700" />
          </div>
        }
        title="Migration Templates"
        description="Download Excel templates with dropdowns and validation for each entity. Fill them out and upload in Historical Migrations."
        actions={
          <button
            type="button"
            className="btn-primary"
            disabled={downloading !== null || !templates.length}
            onClick={() => download('/api/migrations/templates/download-all', 'all')}
          >
            <Download className="w-4 h-4" />
            {downloading === 'all' ? 'Generating…' : 'Download all templates'}
          </button>
        }
      />

      <div className="data-card bg-brand-50 border-brand-200 text-sm text-brand-900">
        Templates are generated fresh on each download. Product and other sheets with{' '}
        <strong>vendor_name</strong> include a dropdown of current system vendors — re-download after
        adding or removing vendors. Ghana phone columns use text format (10 digits starting with 0).
      </div>

      <div className="space-y-4">
        {templates.map((t) => (
          <div key={t.entity_type} className="data-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">{t.label}</h2>
                <p className="text-sm text-slate-500 mt-0.5">{t.description}</p>
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={downloading !== null}
                onClick={() => download(`/api/migrations/templates/${t.entity_type}/download`, t.entity_type)}
              >
                <Download className="w-4 h-4" />
                {downloading === t.entity_type ? 'Generating…' : 'Download .xlsx'}
              </button>
            </div>
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
