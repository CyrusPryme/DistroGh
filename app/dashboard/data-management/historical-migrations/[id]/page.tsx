'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Play, CheckCircle2, AlertTriangle, RefreshCw, ShieldCheck,
  FileSpreadsheet, ArrowRight, RotateCcw,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { PageLoading } from '@/components/shared/PageLoading'
import { cn } from '@/lib/utils'
import { MIGRATION_STAGES, type MigrationEntityType } from '@/lib/migration/types'
import { ENTITY_LABELS } from '@/lib/migration/entities'

type Project = {
  id: string
  name: string
  description: string | null
  status: string
  current_stage: number
  progress_pct: number
  validation_status: string
  dependency_graph: Array<{ entity: string; depends_on: string[]; rank: number }>
  import_order: string[]
  preview_summary: { entities?: Array<Record<string, unknown>> }
  reconciliation: Record<string, { expected: number; imported: number; status: string }>
  error_count: number
  warning_count: number
  rollback_available: boolean
  files_uploaded: number
}

type MigFile = {
  id: string
  original_filename: string
  entity_type: MigrationEntityType | null
  parse_status: string
  row_count: number
  size_bytes: number
}

type Job = {
  id: string
  job_type: string
  entity_type: string | null
  status: string
  progress_pct: number
  current_record: number
  total_records: number
  error_message: string | null
}

type StagingRow = {
  id: string
  entity_type: string
  row_number: number
  validation_status: string
  errors: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  normalized_data: Record<string, unknown>
  corrections: Record<string, unknown>
}

const ENTITY_OPTIONS = Object.keys(ENTITY_LABELS) as MigrationEntityType[]

export default function MigrationWizardPage() {
  const params = useParams()
  const id = String(params.id)
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<MigFile[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [staging, setStaging] = useState<StagingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/migrations/${id}`, { cache: 'no-store' })
    const j = await res.json()
    if (j.success) {
      setProject(j.data.project)
      setFiles(j.data.files)
      setJobs(j.data.jobs)
    }
    setLoading(false)
  }, [id])

  const loadStaging = useCallback(async (status?: string) => {
    const qs = new URLSearchParams({ limit: '50' })
    if (status) qs.set('status', status)
    const res = await fetch(`/api/migrations/${id}/staging?${qs}`)
    const j = await res.json()
    if (j.success) setStaging(j.data)
  }, [id])

  useEffect(() => { load() }, [load])

  // Persist + resume: poll while importing
  useEffect(() => {
    if (!project) return
    const active = ['importing', 'analysing', 'verifying'].includes(project.status)
      || jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      await fetch(`/api/migrations/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process', max_jobs: 3 }),
      }).catch(() => {})
      await load()
    }, 2500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [project?.status, jobs, id, load])

  useEffect(() => {
    if (project && project.current_stage >= 4) {
      loadStaging(project.current_stage === 5 ? 'error' : undefined)
    }
  }, [project?.current_stage, loadStaging])

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/migrations/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Action failed')
      setToast({ type: 'success', message: `${action.replace(/_/g, ' ')} started` })
      await load()
      if (action === 'validate' || action === 'preview') await loadStaging()
    } catch (e) {
      setToast({ type: 'error', message: e instanceof Error ? e.message : 'Action failed' })
    } finally {
      setBusy(false)
    }
  }

  const saveStage = async (stage: number) => {
    await fetch(`/api/migrations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_stage: stage, wizard_state: { stage, saved_at: new Date().toISOString() } }),
    })
    await load()
  }

  const onDrop = useCallback(async (accepted: File[]) => {
    if (!accepted.length) return
    setUploading(true)
    try {
      for (const file of accepted) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/migrations/${id}/files`, { method: 'POST', body: fd })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Upload failed')
      }
      setToast({ type: 'success', message: `${accepted.length} file(s) uploaded` })
      await saveStage(2)
      await load()
    } catch (e) {
      setToast({ type: 'error', message: e instanceof Error ? e.message : 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }, [id])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
  })

  const setEntity = async (fileId: string, entity_type: MigrationEntityType) => {
    await fetch(`/api/migrations/${id}/files`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, entity_type }),
    })
    await load()
  }

  const correctRow = async (row: StagingRow, field: string, value: string) => {
    await fetch(`/api/migrations/${id}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'correct_row',
        row_id: row.id,
        corrections: { [field]: value },
      }),
    })
    await loadStaging('error')
  }

  const stage = project?.current_stage ?? 1
  const importJobs = useMemo(() => jobs.filter((j) => j.job_type === 'import'), [jobs])

  if (loading || !project) return <PageLoading label="Loading migration…" />

  return (
    <div className="space-y-6">
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={() => setToast(null)} />

      <PageHeader
        title={project.name}
        description={project.description || 'Stateful historical migration workspace'}
        actions={
          <button type="button" className="btn-secondary" onClick={load}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        }
      />

      {/* Stage rail */}
      <div className="data-card !p-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {MIGRATION_STAGES.map((s) => (
            <button
              key={s.stage}
              type="button"
              onClick={() => saveStage(s.stage)}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
                stage === s.stage
                  ? 'bg-brand-600 text-white border-brand-600'
                  : stage > s.stage
                    ? 'bg-brand-50 text-brand-800 border-brand-200'
                    : 'bg-white text-slate-500 border-slate-200'
              )}
            >
              {s.stage}. {s.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${project.progress_pct}%` }} />
          </div>
          <span className="text-xs text-slate-500 w-20 text-right">{Number(project.progress_pct).toFixed(0)}%</span>
          <span className="status-badge border bg-slate-50 text-slate-700 border-slate-200">{project.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {/* Stage 2 — Upload */}
      {(stage === 2 || stage === 1) && (
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={cn(
              'data-card border-dashed cursor-pointer text-center py-12',
              isDragActive && 'border-brand-400 bg-brand-50/40'
            )}
          >
            <input {...getInputProps()} />
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <p className="font-medium text-slate-800">
              {uploading ? 'Uploading…' : 'Drag & drop Excel/CSV files here'}
            </p>
            <p className="text-xs text-slate-500 mt-1">xlsx · xls · csv · multiple files · replace anytime</p>
            <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
              All vendors in this migration are imported as <strong>admin-managed</strong> (no portal login).
            </p>
          </div>

          <div className="data-card p-0 overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Entity</th>
                  <th>Parse</th>
                  <th>Rows</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-8">No files uploaded yet</td></tr>
                ) : files.map((f) => (
                  <tr key={f.id}>
                    <td className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-brand-600" />
                      {f.original_filename}
                    </td>
                    <td>
                      <select
                        className="form-input !py-1.5 text-xs"
                        value={f.entity_type ?? ''}
                        onChange={(e) => setEntity(f.id, e.target.value as MigrationEntityType)}
                      >
                        <option value="">Detect / assign…</option>
                        {ENTITY_OPTIONS.map((e) => (
                          <option key={e} value={e}>{ENTITY_LABELS[e]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs">{f.parse_status}</td>
                    <td>{f.row_count}</td>
                    <td className="text-xs text-slate-500">{(f.size_bytes / 1024).toFixed(1)} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={busy || !files.length} onClick={() => runAction('parse')}>
              Parse files
            </button>
            <button type="button" className="btn-primary" disabled={busy || !files.length} onClick={() => runAction('analyse')}>
              Analyse relationships <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Stage 3 — Relationships */}
      {stage === 3 && (
        <div className="space-y-4">
          <div className="data-card">
            <h2 className="font-semibold text-slate-900 mb-3">Detected import order</h2>
            <ol className="space-y-2">
              {(project.import_order.length ? project.import_order : project.dependency_graph.map((g) => g.entity)).map((e, i) => (
                <li key={e} className="flex items-center gap-3 text-sm">
                  <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-800 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="font-medium text-slate-800">{ENTITY_LABELS[e as MigrationEntityType] || e}</span>
                  <span className="text-xs text-slate-400">
                    depends on: {(project.dependency_graph.find((g) => g.entity === e)?.depends_on || []).join(', ') || '—'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => runAction('validate')}>
            Run validation <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stage 4/5 — Validation / Corrections */}
      {(stage === 4 || stage === 5) && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="kpi-card !p-4 text-center">
              <p className="text-xl font-bold text-slate-800">{project.validation_status}</p>
              <p className="text-xs text-slate-500">Validation</p>
            </div>
            <div className="kpi-card !p-4 text-center">
              <p className="text-xl font-bold text-red-600">{project.error_count}</p>
              <p className="text-xs text-slate-500">Error rows</p>
            </div>
            <div className="kpi-card !p-4 text-center">
              <p className="text-xl font-bold text-amber-600">{project.warning_count}</p>
              <p className="text-xs text-slate-500">Warning rows</p>
            </div>
          </div>

          <div className="data-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">
                {stage === 5 ? 'Correction workspace' : 'Validation sample'}
              </p>
              <button type="button" className="btn-ghost text-xs" onClick={() => loadStaging(stage === 5 ? 'error' : undefined)}>
                Reload rows
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Issues</th>
                  <th>Quick fix (name / vendor_name)</th>
                </tr>
              </thead>
              <tbody>
                {staging.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-slate-400 py-8">No rows to show</td></tr>
                ) : staging.map((row) => (
                  <tr key={row.id}>
                    <td className="text-xs">{row.entity_type}</td>
                    <td>{row.row_number}</td>
                    <td>
                      <span className={cn(
                        'status-badge border',
                        row.validation_status === 'error' ? 'bg-red-50 text-red-700 border-red-200'
                          : row.validation_status === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-brand-50 text-brand-700 border-brand-200'
                      )}>
                        {row.validation_status}
                      </span>
                    </td>
                    <td className="text-xs text-slate-600 max-w-xs">
                      {[...(row.errors || []), ...(row.warnings || [])].map((i) => i.message).join('; ') || '—'}
                    </td>
                    <td>
                      <input
                        className="form-input !py-1 text-xs"
                        defaultValue={String(row.corrections?.name ?? row.normalized_data?.name ?? row.normalized_data?.vendor_name ?? '')}
                        onBlur={(e) => {
                          const field = row.entity_type === 'vendors' || row.entity_type === 'categories' ? 'name' : 'vendor_name'
                          if (e.target.value) correctRow(row, field, e.target.value)
                        }}
                        placeholder="Inline correction"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => runAction('validate')}>
              Re-validate
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => runAction('preview')}>
              Build preview <ArrowRight className="w-4 h-4" />
            </button>
            <a href="/dashboard/sales/import" className="btn-ghost text-xs">
              Open monthly sales correction UI (reuse for sales Excel)
            </a>
          </div>
        </div>
      )}

      {/* Stage 6 — Preview */}
      {stage === 6 && (
        <div className="space-y-4">
          <div className="data-card p-0 overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Total</th>
                  <th>Create</th>
                  <th>Update</th>
                  <th>Skip</th>
                  <th>Errors</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {(project.preview_summary?.entities || []).map((e: Record<string, unknown>) => (
                  <tr key={String(e.entity_type)}>
                    <td>{ENTITY_LABELS[e.entity_type as MigrationEntityType] || String(e.entity_type)}</td>
                    <td>{String(e.total)}</td>
                    <td>{String(e.to_create)}</td>
                    <td>{String(e.to_update)}</td>
                    <td>{String(e.to_skip)}</td>
                    <td className="text-red-600">{String(e.errors)}</td>
                    <td className="text-amber-600">{String(e.warnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn-primary" disabled={busy || project.error_count > 0} onClick={() => saveStage(7)}>
            Proceed to approval <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stage 7 — Approval */}
      {stage === 7 && (
        <div className="data-card space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-6 h-6 text-brand-600 mt-0.5" />
            <div>
              <h2 className="font-semibold text-slate-900">Approve production import</h2>
              <p className="text-sm text-slate-500 mt-1">
                Staging data will be written to production in dependency order using transactional background jobs.
                No partial financial commit without reconciliation.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => runAction('approve')}>
              <CheckCircle2 className="w-4 h-4" /> Approve migration
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !['approved', 'ready'].includes(project.status)}
              onClick={() => runAction('start_import')}
            >
              <Play className="w-4 h-4" /> Start import
            </button>
          </div>
        </div>
      )}

      {/* Stage 8/9 — Import / Verification */}
      {(stage === 8 || stage === 9 || project.status === 'importing') && (
        <div className="space-y-4">
          {importJobs.map((j) => (
            <div key={j.id} className="data-card">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-800">
                  Importing {j.entity_type || '…'} · {j.status}
                </p>
                <p className="text-xs text-slate-500">
                  {j.current_record} / {j.total_records || '…'}
                </p>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-600" style={{ width: `${j.progress_pct}%` }} />
              </div>
              {j.error_message && (
                <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {j.error_message}
                </p>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => runAction('process')}>
            Process next job chunk
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => runAction('reconcile')}>
            Run reconciliation
          </button>
        </div>
      )}

      {/* Stage 10 — Report */}
      {(stage === 10 || project.status === 'completed' || project.status === 'rolled_back') && (
        <div className="space-y-4">
          <div className="data-card">
            <h2 className="font-semibold text-slate-900 mb-3">Reconciliation report</h2>
            <div className="space-y-2">
              {Object.entries(project.reconciliation || {}).map(([entity, r]) => (
                <div key={entity} className="flex items-center justify-between text-sm border-b border-slate-50 py-2">
                  <span className="font-medium text-slate-800">{ENTITY_LABELS[entity as MigrationEntityType] || entity}</span>
                  <span className="text-slate-500">{r.imported} / {r.expected}</span>
                  <span className={cn(
                    'status-badge border',
                    r.status === 'balanced' ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-red-50 text-red-700 border-red-200'
                  )}>
                    {r.status}
                  </span>
                </div>
              ))}
              {!Object.keys(project.reconciliation || {}).length && (
                <p className="text-sm text-slate-400">No reconciliation data yet.</p>
              )}
            </div>
          </div>
          {project.rollback_available && (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => runAction('rollback')}>
              <RotateCcw className="w-4 h-4" /> Rollback entire migration
            </button>
          )}
        </div>
      )}
    </div>
  )
}
