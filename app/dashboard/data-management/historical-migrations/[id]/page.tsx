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
import { BusyOverlay } from '@/components/shared/BusyOverlay'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'
import { cn } from '@/lib/utils'
import { MIGRATION_STAGES, type MigrationEntityType, type MigrationStatus } from '@/lib/migration/types'
import { ENTITY_LABELS } from '@/lib/migration/entities'
import { canDeleteMigration, needsMigrationRetry, canRestartMigration, needsRevalidation, migrationAwaitingImportStart } from '@/lib/migration/lifecycle'

type Project = {
  id: string
  name: string
  description: string | null
  status: MigrationStatus
  current_stage: number
  progress_pct: number
  validation_status: string
  dependency_graph: Array<{ entity: string; depends_on: string[]; missing_dependencies?: string[]; rank: number }>
  import_order: string[]
  preview_summary: {
    entities?: Array<Record<string, unknown>>
    delivery_exceptions?: { total: number; no_branch: number; no_transport_cost: number }
    category_changes?: { products_with_category_value: number; new_categories: number }
    financial_discrepancies?: Array<{
      entity_type: string
      category: string
      expected_value: number | null
      actual_value: number | null
      difference: number | null
      severity: 'info' | 'warning' | 'error'
      details?: Record<string, unknown>
    }>
  }
  reconciliation: Record<string, { expected: number; imported: number; status: string }>
  error_count: number
  warning_count: number
  rollback_available: boolean
  files_uploaded: number
  error_summary?: { cancel_reason?: string; cancelled_at?: string; import_error?: string; failed_at?: string }
  last_parsed_at?: string | null
  last_validated_at?: string | null
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
  infos: Array<{ code: string; message: string }>
  normalized_data: Record<string, unknown>
  corrections: Record<string, unknown>
}

const ENTITY_OPTIONS = Object.keys(ENTITY_LABELS) as MigrationEntityType[]

const ACTION_BUSY_LABELS: Record<string, { label: string; sublabel?: string }> = {
  analyse: { label: 'Analysing relationships…', sublabel: 'Mapping entities and building the import order.' },
  parse: { label: 'Parsing files…', sublabel: 'Reading rows from your uploaded spreadsheets.' },
  validate: { label: 'Validating data…', sublabel: 'Checking every row for errors and warnings.' },
  preview: { label: 'Building preview…' },
  approve: { label: 'Approving migration…' },
  start_import: { label: 'Starting import…', sublabel: 'Writing staged data to production. Please don\u2019t close this tab.' },
  reconcile: { label: 'Reconciling…', sublabel: 'Verifying imported counts match expectations.' },
  rollback: { label: 'Rolling back…', sublabel: 'Undoing production changes from this migration.' },
  restart: { label: 'Resetting workspace…', sublabel: 'Clearing uploads so you can start fresh.' },
  process: { label: 'Processing…' },
  correct_row: { label: 'Saving correction…' },
}

export default function MigrationWizardPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params.id)
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<MigFile[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [staging, setStaging] = useState<StagingRow[]>([])
  const [stagingTotal, setStagingTotal] = useState(0)
  const [stagingFilter, setStagingFilter] = useState<'error' | 'warning' | 'issues'>('error')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState<{ label: string; sublabel?: string } | null>(null)
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
    const qs = new URLSearchParams({ limit: '200' })
    if (status) qs.set('status', status)
    const res = await fetch(`/api/migrations/${id}/staging?${qs}`)
    const j = await res.json()
    if (j.success) {
      setStaging(j.data)
      setStagingTotal(typeof j.total === 'number' ? j.total : j.data.length)
    }
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
    if (!project || project.current_stage !== 5) return
    if (project.error_count > 0) setStagingFilter('error')
    else if (project.warning_count > 0) setStagingFilter('issues')
  }, [project?.current_stage, project?.error_count, project?.warning_count])

  useEffect(() => {
    if (project && project.current_stage >= 4) {
      loadStaging(project.current_stage === 5 ? stagingFilter : undefined)
    }
  }, [project?.current_stage, loadStaging, stagingFilter])

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusyLabel(ACTION_BUSY_LABELS[action] ?? { label: 'Working…' })
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
          ? 'Workspace cleared — upload your corrected files'
          : `${action.replace(/_/g, ' ')} started`
      setToast({ type: 'success', message: label })
      await load()
      if (action === 'validate' || action === 'preview') await loadStaging()
    } catch (e) {
      setToast({ type: 'error', message: e instanceof Error ? e.message : 'Action failed' })
    } finally {
      setBusy(false)
      setBusyLabel(null)
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
    setBusyLabel({ label: 'Removing file…' })
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
      setBusyLabel(null)
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
  const needsRetry = project ? needsMigrationRetry(project) : false
  const canRetry = project ? canRestartMigration(project) : false
  const isLocked = project
    ? ['completed', 'archived', 'cancelled'].includes(project.status) || needsRetry
    : false
  const canManageFiles = project
    ? !needsRetry && !['importing', 'completed', 'archived'].includes(project.status)
    : false
  const deletable = project ? canDeleteMigration(project) : false
  // Files were re-parsed after the last successful validation — the staging rows are back to
  // 'pending' and haven't actually been checked in their current form. Approving or starting an
  // import in this state used to silently import nothing while reporting "completed".
  const staleValidation = project ? needsRevalidation(project) : false
  const awaitingImportStart =
    project &&
    migrationAwaitingImportStart(project) &&
    !jobs.some((j) => j.job_type === 'import')

  const handleCancel = async () => {
    const reason = cancelReason.trim()
    if (!reason) {
      setCancelError('Please provide a reason for cancelling this migration.')
      return
    }
    setCancelError(null)
    setBusyLabel({ label: 'Cancelling migration…', sublabel: 'Stopping jobs and clearing uploaded files.' })
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
      setToast({ type: 'success', message: 'Migration cancelled — click Upload corrected files when your spreadsheets are ready' })
      await load()
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Cancellation failed')
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }

  const handleDelete = async () => {
    setDeleteError(null)
    setBusyLabel({ label: 'Deleting migration…', sublabel: 'Removing uploads, staging data, and job history.' })
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
      setBusyLabel(null)
    }
  }

  if (loading || !project) return <PageLoading label="Loading migration…" />

  return (
    <div className="space-y-6">
      <PageToast message={toast?.message ?? null} type={toast?.type} onDismiss={() => setToast(null)} />
      <BusyOverlay
        active={uploading || (busy && !cancelOpen && !deleteOpen)}
        label={uploading ? 'Uploading files…' : busyLabel?.label ?? 'Working…'}
        sublabel={uploading ? 'Please wait while your files are attached to this migration.' : busyLabel?.sublabel}
      />

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
            {canRetry && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => runAction('restart')}
              >
                <RotateCcw className="w-4 h-4" />
                Upload corrected files
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
                  : <>Fix the data if needed, then use <strong>Process next job chunk</strong> to retry import. Upload a corrected spreadsheet to replace an existing file, or use <strong>Upload corrected files</strong> to reset everything.</>}
              </p>
            </div>
          </div>
        </div>
      )}

      {(needsRetry && (cancelReasonText || project.status === 'rolled_back')) && (
        <div className={cn(
          'data-card',
          project.status === 'rolled_back' ? 'bg-amber-50 border-amber-200' : 'bg-amber-50 border-amber-200'
        )}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <RotateCcw className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="font-semibold text-amber-900">
                  {project.status === 'rolled_back' ? 'Migration rolled back' : 'Ready for corrected files'}
                </h2>
                <p className="text-sm text-amber-800 mt-1">
                  {project.status === 'rolled_back'
                    ? 'Production changes from this migration were undone. You can fix your spreadsheets and run the import again.'
                    : 'Your previous attempt was stopped so you could fix mistakes in the source files.'}
                </p>
                {cancelReasonText && (
                  <p className="text-sm text-amber-800 mt-2">
                    Reason: {cancelReasonText}
                  </p>
                )}
                <p className="text-xs text-amber-700 mt-2">
                  Click <strong>Upload corrected files</strong> to clear the workspace, then upload again — the same filenames are fine.
                </p>
              </div>
            </div>
            {canRetry && (
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={busy}
                onClick={() => runAction('restart')}
              >
                <RotateCcw className="w-4 h-4" />
                Upload corrected files
              </button>
            )}
          </div>
        </div>
      )}

      {(cancelReasonText && !needsRetry && (project.status === 'failed' || project.status === 'draft')) && (
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

      {awaitingImportStart && (
        <div className="flex items-start gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-brand-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-brand-900">Validation complete — import not started yet</p>
            <p className="text-xs text-brand-800 mt-0.5">
              {project.preview_summary?.entities?.[0]
                ? `${String((project.preview_summary.entities[0] as Record<string, unknown>).total ?? 0)} intake rows are ready.`
                : 'Staged rows are ready.'}{' '}
              The progress bar stays low until import runs — go to <strong>Stage 7 · Approval</strong> and click{' '}
              <strong>Start import</strong>.
            </p>
          </div>
          <button type="button" className="btn-primary shrink-0" disabled={busy || staleValidation} onClick={() => saveStage(7)}>
            Go to approval
          </button>
        </div>
      )}

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
            <p className="text-xs text-slate-500 mt-1">xlsx · xls · csv · multiple files · re-uploading the same filename replaces the previous version</p>
            <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block max-w-xl mx-auto">
              Vendors: use <strong>momo_number</strong> (MoMo wallet for payouts) and <strong>contact_phone</strong> (business/contact line) as separate columns.
              All vendors import as <strong>admin-managed</strong> (no portal login).
            </p>
          </div>
          ) : needsRetry ? (
            <div className="data-card text-center py-10">
              <RotateCcw className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <p className="text-slate-700 font-medium">Upload area locked until you reset the workspace</p>
              <p className="text-sm text-slate-500 mt-1 max-w-lg mx-auto">
                Click <strong>Upload corrected files</strong> above, then drag the same spreadsheets back in with your fixes applied.
              </p>
              {canRetry && (
                <button
                  type="button"
                  className="btn-primary mt-4"
                  disabled={busy}
                  onClick={() => runAction('restart')}
                >
                  <RotateCcw className="w-4 h-4" />
                  Upload corrected files
                </button>
              )}
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
          {(() => {
            const missing = project.dependency_graph.filter((g) => (g.missing_dependencies?.length ?? 0) > 0)
            if (!missing.length) return null
            return (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">Possible out-of-order upload</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    {missing.map((g) => (
                      <li key={g.entity}>
                        <span className="font-medium">{ENTITY_LABELS[g.entity as MigrationEntityType] || g.entity}</span> is
                        staged, but{' '}
                        <span className="font-medium">
                          {(g.missing_dependencies ?? []).map((d) => ENTITY_LABELS[d as MigrationEntityType] || d).join(', ')}
                        </span>{' '}
                        {(g.missing_dependencies?.length ?? 0) > 1 ? "haven't" : "hasn't"} been uploaded here and{' '}
                        {(g.missing_dependencies?.length ?? 0) > 1 ? "don't" : "doesn't"} exist in production yet.
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-amber-700">
                    This won&apos;t block the import, but double-check it isn&apos;t a mistake — e.g. Deliveries without any
                    Receiving records on record means stock is being sent out that was never recorded as received.
                  </p>
                </div>
              </div>
            )
          })()}
          <div className="data-card">
            <h2 className="font-semibold text-slate-900 mb-3">Detected import order</h2>
            <ol className="space-y-2">
              {(project.import_order.length ? project.import_order : project.dependency_graph.map((g) => g.entity)).map((e, i) => {
                const node = project.dependency_graph.find((g) => g.entity === e)
                const hasMissing = (node?.missing_dependencies?.length ?? 0) > 0
                return (
                  <li key={e} className="flex items-center gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-800 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="font-medium text-slate-800">{ENTITY_LABELS[e as MigrationEntityType] || e}</span>
                    <span className="text-xs text-slate-400">
                      depends on: {(node?.depends_on || []).join(', ') || '—'}
                    </span>
                    {hasMissing && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> missing: {(node?.missing_dependencies ?? []).join(', ')}
                      </span>
                    )}
                  </li>
                )
              })}
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
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {stage === 5 ? 'Correction workspace' : 'Validation sample'}
                </p>
                {stage === 5 && stagingTotal > staging.length ? (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Showing {staging.length} of {stagingTotal} rows — narrow with filters or fix in spreadsheet
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {stage === 5 ? (
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                    {([
                      ['error', 'Errors'],
                      ['warning', 'Warnings'],
                      ['issues', 'All issues'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          'px-2.5 py-1.5 font-medium transition-colors',
                          stagingFilter === value
                            ? value === 'error'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-amber-50 text-amber-800'
                            : 'bg-white text-slate-600 hover:bg-slate-50'
                        )}
                        onClick={() => setStagingFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => loadStaging(stage === 5 ? stagingFilter : undefined)}
                >
                  Reload rows
                </button>
              </div>
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
                  <tr>
                    <td colSpan={5} className="text-center text-slate-400 py-8">
                      {stage === 5 && project.warning_count > 0 && project.error_count === 0
                        ? 'No error rows — switch to Warnings or All issues to review rows that still need attention'
                        : 'No rows to show'}
                    </td>
                  </tr>
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
                    <td className="text-xs text-slate-600 max-w-xs space-y-0.5">
                      {row.errors?.length ? (
                        <p className="text-red-600">{row.errors.map((i) => i.message).join('; ')}</p>
                      ) : null}
                      {row.warnings?.length ? (
                        <p className="text-amber-600">{row.warnings.map((i) => i.message).join('; ')}</p>
                      ) : null}
                      {row.infos?.length ? (
                        <p className="text-slate-400">{row.infos.map((i) => i.message).join('; ')}</p>
                      ) : null}
                      {!row.errors?.length && !row.warnings?.length && !row.infos?.length ? '—' : null}
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

          {(project.preview_summary?.delivery_exceptions || project.preview_summary?.category_changes) && (
            <div className="grid gap-4 md:grid-cols-2">
              {project.preview_summary?.delivery_exceptions && (
                <div className="data-card p-4 space-y-2">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Delivery exceptions
                  </h3>
                  <p className="text-sm text-slate-600">
                    Historical deliveries with no branch:{' '}
                    <span className="font-medium text-slate-900">{project.preview_summary.delivery_exceptions.no_branch}</span> records
                  </p>
                  <p className="text-sm text-slate-600">
                    Historical deliveries with no transport cost:{' '}
                    <span className="font-medium text-slate-900">{project.preview_summary.delivery_exceptions.no_transport_cost}</span> records
                  </p>
                  <p className="text-xs text-slate-400">
                    These are accepted historical records (branch/warehouse redistribution not part of the original
                    delivery transaction; transport cost not recorded in source) — never fabricated.
                  </p>
                </div>
              )}
              {project.preview_summary?.category_changes && (
                <div className="data-card p-4 space-y-2">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" /> Product category changes
                  </h3>
                  <p className="text-sm text-slate-600">
                    Products with an incoming category value (populate/unchanged/override):{' '}
                    <span className="font-medium text-slate-900">
                      {project.preview_summary.category_changes.products_with_category_value}
                    </span>{' '}
                    records
                  </p>
                  <p className="text-sm text-slate-600">
                    New categories detected:{' '}
                    <span className="font-medium text-slate-900">{project.preview_summary.category_changes.new_categories}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Exact per-product overrides (previous → new category, with source row) are recorded per-row in
                    the audit log and are reversible via migration rollback.
                  </p>
                </div>
              )}
            </div>
          )}

          {!!project.preview_summary?.financial_discrepancies?.length && (
            <div className="data-card p-0 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Financial integrity discrepancies
                </h3>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Category</th>
                    <th>Expected</th>
                    <th>Actual</th>
                    <th>Difference</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {project.preview_summary.financial_discrepancies.map((d, idx) => (
                    <tr key={idx}>
                      <td>{d.entity_type}</td>
                      <td>{d.category.replace(/_/g, ' ')}</td>
                      <td>{d.expected_value ?? '—'}</td>
                      <td>{d.actual_value ?? '—'}</td>
                      <td>{d.difference ?? '—'}</td>
                      <td
                        className={cn(
                          d.severity === 'error' && 'text-red-600',
                          d.severity === 'warning' && 'text-amber-600',
                          d.severity === 'info' && 'text-slate-500'
                        )}
                      >
                        {d.severity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={
              busy ||
              project.error_count > 0 ||
              !!project.preview_summary?.financial_discrepancies?.some((d) => d.severity === 'error')
            }
            onClick={() => saveStage(7)}
          >
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

          {staleValidation && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-900">Re-validation required</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Files were re-parsed after the last successful validation, so the current data hasn&apos;t actually
                  been checked yet. Approve and Start import are disabled until you validate again.
                </p>
              </div>
              <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={() => runAction('validate')}>
                <RefreshCw className="w-4 h-4" /> Validate now
              </button>
            </div>
          )}

          {['approved', 'ready'].includes(project.status) ? (
            <div className="flex items-start gap-3 bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
              <CheckCircle2 className="w-5 h-5 text-brand-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-brand-900">Approved — ready to import</p>
                <p className="text-xs text-brand-700 mt-0.5">
                  This migration has been approved. Starting the import writes data to production; this cannot be
                  cancelled mid-run without a rollback.
                </p>
              </div>
              <button type="button" className="btn-primary shrink-0" disabled={busy || staleValidation} onClick={() => runAction('start_import')}>
                <Play className="w-4 h-4" /> Start import
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">Step 1 of 2 — Approve this migration</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Once approved, you&apos;ll get a Start import button here to begin writing to production.
                </p>
              </div>
              <button type="button" className="btn-primary shrink-0" disabled={busy || staleValidation} onClick={() => runAction('approve')}>
                <CheckCircle2 className="w-4 h-4" /> Approve migration
              </button>
            </div>
          )}
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
                    {r.status === 'unvalidated' ? 'not validated' : r.status}
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
