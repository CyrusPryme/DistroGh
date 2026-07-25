'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { History, Plus, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MIGRATION_STAGES } from '@/lib/migration/types'

type Migration = {
  id: string
  name: string
  description: string | null
  status: string
  current_stage: number
  progress_pct: number
  validation_status: string
  files_uploaded: number
  error_count: number
  warning_count: number
  last_activity_at: string
  created_at: string
}

function statusTone(status: string) {
  if (status === 'completed') return 'bg-brand-50 text-brand-700 border-brand-200'
  if (status === 'failed' || status === 'rolled_back') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'importing' || status === 'analysing') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (status === 'awaiting_correction') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-slate-50 text-slate-700 border-slate-200'
}

function MigrationsList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusFilter = searchParams.get('status') || ''
  const wantNew = searchParams.get('new') === '1'

  const [items, setItems] = useState<Migration[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(wantNew)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
      const res = await fetch(`/api/migrations${qs}`)
      const j = await res.json()
      if (j.success) setItems(j.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])
  useEffect(() => { if (wantNew) setModal(true) }, [wantNew])

  const create = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/migrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Create failed')
      setToast({ type: 'success', message: 'Migration created' })
      setModal(false)
      router.push(`/dashboard/data-management/historical-migrations/${j.data.id}`)
    } catch (e) {
      setToast({ type: 'error', message: e instanceof Error ? e.message : 'Create failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={() => setToast(null)} />

      <PageHeader
        icon={
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <History className="w-5 h-5 text-brand-700" />
          </div>
        }
        title="Historical Migrations"
        description="Persistent migration projects. Refresh-safe, resumable, never writes production until approval."
        actions={
          <>
            <button type="button" onClick={load} className="btn-secondary">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button type="button" onClick={() => setModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" />
              New Migration
            </button>
          </>
        }
      />

      <div className="data-card p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Stage</th>
              <th>Progress</th>
              <th>Files</th>
              <th>Errors</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center text-slate-400 py-10">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-400 py-10">No migrations yet.</td></tr>
            ) : items.map((m) => {
              const stageLabel = MIGRATION_STAGES.find((s) => s.stage === m.current_stage)?.label ?? `Stage ${m.current_stage}`
              return (
                <tr key={m.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/data-management/historical-migrations/${m.id}`)}>
                  <td>
                    <Link href={`/dashboard/data-management/historical-migrations/${m.id}`} className="font-medium text-slate-800 hover:text-brand-700">
                      {m.name}
                    </Link>
                    {m.description && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{m.description}</p>}
                  </td>
                  <td>
                    <span className={cn('status-badge border', statusTone(m.status))}>{m.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="text-xs text-slate-600">{m.current_stage}. {stageLabel}</td>
                  <td>
                    <div className="w-28">
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-600" style={{ width: `${m.progress_pct}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{Number(m.progress_pct).toFixed(0)}%</p>
                    </div>
                  </td>
                  <td>{m.files_uploaded}</td>
                  <td className={m.error_count ? 'text-red-600 font-medium' : 'text-slate-500'}>{m.error_count}</td>
                  <td className="text-xs text-slate-500">{new Date(m.last_activity_at).toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <FormModal open={modal} onClose={() => setModal(false)} title="Create Migration Project" description="A durable project that survives refresh, logout, and deploy.">
        <FormModalBody>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Name</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Historical Migration 2022–2024" autoFocus />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1.5 block">Description</label>
            <textarea className="form-input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes about source systems and periods" />
          </div>
        </FormModalBody>
        <FormModalFooter>
          <button type="button" className="btn-secondary flex-1" onClick={() => setModal(false)}>Cancel</button>
          <button type="button" className="btn-primary flex-1" disabled={!name.trim() || saving} onClick={create}>
            {saving ? 'Creating…' : 'Create & open wizard'}
          </button>
        </FormModalFooter>
      </FormModal>
    </div>
  )
}

export default function HistoricalMigrationsPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 py-10 text-center">Loading…</div>}>
      <MigrationsList />
    </Suspense>
  )
}
