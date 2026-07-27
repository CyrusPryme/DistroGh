'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Play, CheckCircle2, AlertTriangle, RefreshCw, ShieldCheck,
  FileSpreadsheet, ArrowRight, RotateCcw, XCircle, Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { PageToast } from '@/components/shared/PageToast'
import { PageLoading } from '@/components/shared/PageLoading'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { cn } from '@/lib/utils'
import { MIGRATION_STAGES, type MigrationEntityType } from '@/lib/migration/types'
import { ENTITY_LABELS } from '@/lib/migration/entities'
import { canDeleteMigration } from '@/lib/migration/lifecycle'

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
  error_summary?: { cancel_reason?: string; cancelled_at?: string; import_error?: string; failed_at?: string }
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
  const router = useRouter()
  const id = String(params.id)
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<MigFile[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [staging, setStaging] = useState<StagingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
      || (project.status === 'failed' && !project.error_summary?.cancel_reason)
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
      const label = action === 'cancel'
        ? 'Migration cancelled'
        : action === 'restart'
          ? 'Ready for new uploads'
          : `${action.replace(/_/g, ' ')} started`
      setToast({ type: 'success', message: label })
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

  const removeFile = async (fileId: string, filename: string) => {
    if (!confirm(`Remove "${filename}" from this migration?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/migrations/${id}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Failed to remove file')
      setToast({ type: 'success', message: 'File removed' })
      await load()
    } catch (e) {
      setToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to remove file' })
    } finally {
      setBusy(false)
    }
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
  const cancelReasonText = project?.error_summary?.cancel_reason
  const isUserCancelled = Boolean(cancelReasonText)
  const importErrorText = project?.error_summary?.import_error
  const isLocked = project
    ? ['completed', 'rolled_back', 'archived', 'cancelled'].includes(project.status) || isUserCancelled
    : false
  const needsRestart = project?.status === 'failed' && isUserCancelled
  const showStartOver = project?.status === 'failed'
  const canManageFiles = project
    ? !['importing', 'completed', 'rolled_back', 'archived'].includes(project.status) && !needsRestart
    : false
  const deletable = project ? canDeleteMigration(project) : false

  const handleCancel = async () => {
    const reason = cancelReason.trim()
    if (!reason) {
      setCancelError('Please provide a reason for cancelling this migration.')
      return
    }
    setCancelError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/migrations/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason }),
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Cancellation failed')
      setCancelOpen(false)
      setCancelReason('')
      setToast({ type: 'success', message: 'Migration cancelled — uploads cleared, ready for new files' })
      await load()
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Cancellation failed')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setDeleteError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/migrations/${id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!j.success) throw new Error(j.error || 'Delete failed')
      router.push('/dashboard/data-management/historical-migrations')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !project) return <PageLoading label="Loading migration…" />

  return (
    <div className="space-y-6">
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={() => setToast(null)} />

      <PageHeader
        title={project.name}
        description={project.description || 'Stateful historical migration workspace'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isLocked && (
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => {
                  setCancelError(null)
                  setCancelOpen(true)
                }}
              >
                <XCircle className="w-4 h-4" />
                Cancel migration
              </button>
            )}
            {showStartOver && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => runAction('restart')}
              >
                Start over with new files
              </button>
            )}
            {deletable && (
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => {
                  setDeleteError(null)
                  setDeleteOpen(true)
                }}
              >
                <Trash2 className="w-4 h-4" />
                Delete migration
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={load}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        }
      />

      {importErrorText && !isUserCancelled && (
        <div className="data-card bg-red-50 border-red-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-red-900">Import error</h2>
              <p className="text-sm text-red-800 mt-1 font-mono text-xs break-all">{importErrorText}</p>
              <p className="text-xs text-red-700 mt-2">
                {importErrorText.includes('momo_network')
                  ? 'The mobile money network issue is fixed — click Process next job chunk to retry the import. Only upload new files if you changed the spreadsheet.'
                  : <>Fix the data if needed, then use <strong>Process next job chunk</strong> to retry import. Use <strong>Start over with new files</strong> only if you want to replace all uploads.</>}
              </p>
            </div>
          </div>
        </div>
      )}

      {(cancelReasonText && (project.status === 'failed' || project.status === 'draft')) && (
        <div className={cn(
          'data-card',
          project.status === 'failed' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
        )}>
          <div className="flex items-start gap-3">
            <XCircle className={cn(
              'w-5 h-5 flex-shrink-0 mt-0.5',
              project.status === 'failed' ? 'text-red-600' : 'text-amber-600'
            )} />
            <div>
              <h2 className={cn(
                'font-semibold',
                project.status === 'failed' ? 'text-red-900' : 'text-amber-900'
              )}>
                {project.status === 'failed' ? 'Migration cancelled' : 'Previous attempt cancelled'}
              </h2>
              <p className={cn(
                'text-sm mt-1',
                project.status === 'failed' ? 'text-red-800' : 'text-amber-800'
              )}>
                {cancelReasonText}
              </p>
              {project.error_summary?.cancelled_at && (
                <p className={cn(
                  'text-xs mt-2',
                  project.status === 'failed' ? 'text-red-600' : 'text-amber-700'
                )}>
                  Cancelled {new Date(project.error_summary.cancelled_at).toLocaleString()}
                  {project.status === 'draft' ? ' · Upload new files below to continue.' : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <FormModal
        open={cancelOpen}
        onClose={() => {
          if (busy) return
          setCancelOpen(false)
          setCancelError(null)
        }}
        title="Cancel migration"
        description="This stops all jobs, clears uploaded files, and logs the cancellation. You can upload new files immediately after."
        error={cancelError}
        disableBackdropClose={busy}
        maxWidthClass="max-w-lg"
      >
        <FormModalBody>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="cancel-reason">
            Reason for cancellation <span className="text-red-600">*</span>
          </label>
          <textarea
            id="cancel-reason"
            className="form-input min-h-[120px] resize-y"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Explain why this migration is being cancelled…"
            disabled={busy}
          />
        </FormModalBody>
        <FormModalFooter>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setCancelOpen(false)
              setCancelError(null)
            }}
          >
            Keep migration
          </button>
          <button type="button" className="btn-danger" disabled={busy} onClick={handleCancel}>
            {busy ? 'Cancelling…' : 'Cancel migration'}
          </button>
        </FormModalFooter>
      </FormModal>

      <FormModal
        open={deleteOpen}
        onClose={() => {
          if (busy) return
          setDeleteOpen(false)
          setDeleteError(null)
        }}
        title="Delete migration"
        description="This permanently removes the migration project, uploaded files, staging data, and job history. This cannot be undone."
        error={deleteError}
        disableBackdropClose={busy}
        maxWidthClass="max-w-lg"
      >
        <FormModalBody>
          <p className="text-sm text-slate-700">
            Delete <strong>{project.name}</strong>?
          </p>
          {cancelReasonText && (
            <p className="text-xs text-slate-500 mt-2">Cancellation reason: {cancelReasonText}</p>
          )}
          {importErrorText && !cancelReasonText && (
            <p className="text-xs text-slate-500 mt-2 font-mono break-all">Last error: {importErrorText}</p>
          )}
        </FormModalBody>
        <FormModalFooter>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setDeleteOpen(false)
              setDeleteError(null)
            }}
          >
            Keep migration
          </button>
          <button type="button" className="btn-danger" disabled={busy} onClick={handleDelete}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </FormModalFooter>
      </FormModal>

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
          {canManageFiles ? (
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
            <p className="text-xs text-slate-500 mt-1">xlsx · xls · csv · multiple files · remove and re-upload anytime</p>
            <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block max-w-xl mx-auto">
              Vendors: use <strong>momo_number</strong> (MoMo wallet for payouts) and <strong>contact_phone</strong> (business/contact line) as separate columns.
              All vendors import as <strong>admin-managed</strong> (no portal login).
            </p>
          </div>
          ) : needsRestart ? (
            <div className="data-card text-center py-10">
              <p className="text-slate-600">Uploaded files from the cancelled attempt are still attached.</p>
              <p className="text-sm text-slate-500 mt-1">Click <strong>Start over with new files</strong> to clear them and upload again.</p>
            </div>
          ) : null}

          <div className="data-card p-0 overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Entity</th>
                  <th>Parse</th>
                  <th>Rows</th>
                  <th>Size</th>
                  {canManageFiles && <th className="text-right">Remove</th>}
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr><td colSpan={canManageFiles ? 6 : 5} className="text-center text-slate-400 py-8">No files uploaded yet</td></tr>
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
                        disabled={!canManageFiles || busy}
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
                    {canManageFiles && (
                      <td className="text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          disabled={busy}
                          onClick={() => removeFile(f.id, f.original_filename)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      </td>
                    )}
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
                  <th>Quick fix</th>
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
                      {row.entity_type === 'vendors' ? (
                        <div className="space-y-1 min-w-[200px]">
                          <input
                            className="form-input !py-1 text-xs w-full"
                            placeholder="momo_number"
                            defaultValue={String(row.corrections?.momo_number ?? row.normalized_data?.momo_number ?? '')}
                            onBlur={(e) => {
                              if (e.target.value) correctRow(row, 'momo_number', e.target.value)
                            }}
                          />
                          <input
                            className="form-input !py-1 text-xs w-full"
                            placeholder="contact_phone"
                            defaultValue={String(row.corrections?.contact_phone ?? row.normalized_data?.contact_phone ?? '')}
                            onBlur={(e) => {
                              if (e.target.value) correctRow(row, 'contact_phone', e.target.value)
                            }}
                          />
                        </div>
                      ) : (
                        <input
                          className="form-input !py-1 text-xs"
                          defaultValue={String(row.corrections?.name ?? row.normalized_data?.name ?? row.normalized_data?.vendor_name ?? '')}
                          onBlur={(e) => {
                            const field = row.entity_type === 'categories' ? 'name' : 'vendor_name'
                            if (e.target.value) correctRow(row, field, e.target.value)
                          }}
                          placeholder="Inline correction"
                        />
                      )}
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
      {(stage === 8 || stage === 9 || project.status === 'importing' || (project.status === 'failed' && importErrorText)) && (
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
