import type { Pool, PoolClient } from 'pg'
import type {
  MigrationEntityType,
  MigrationProject,
  MigrationStatus,
} from '@/lib/migration/types'
import { MIGRATION_TERMINAL_STATUSES } from '@/lib/migration/types'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { writeAuditLog } from '@/lib/rbac/audit'
import { cancelMigrationJobs } from '@/lib/migration/jobs'
import { clearMigrationUploads } from '@/lib/migration/files'
import {
  canDeleteMigration,
  canRestartMigration,
  isMigrationUserCancelled,
  migrationProgressForStage,
} from '@/lib/migration/lifecycle'

export {
  isMigrationUserCancelled,
  canDeleteMigration,
  canRestartMigration,
  needsMigrationRetry,
  needsRevalidation,
} from '@/lib/migration/lifecycle'

type Db = Pool | PoolClient

export function isMigrationTerminal(status: MigrationStatus): boolean {
  return MIGRATION_TERMINAL_STATUSES.includes(status)
}

/** Block migration work (import, reconcile, validate, etc.). Import failures stay recoverable. */
export function isMigrationWorkBlocked(project: MigrationProject): boolean {
  if (isMigrationUserCancelled(project)) return true
  if (project.status === 'failed') return false
  if (project.status === 'rolled_back') return true
  return isMigrationTerminal(project.status)
}

/** Clear a stopped migration so corrected spreadsheets can be uploaded again. */
export async function prepareMigrationRetry(
  db: Pool,
  migrationId: string,
  actorId: string
): Promise<MigrationProject | null> {
  const project = await getMigrationProject(db, migrationId)
  if (!project) throw new Error('Migration not found')
  if (!canRestartMigration(project)) {
    throw new Error('This migration cannot be reset for a new upload attempt')
  }

  await cancelMigrationJobs(db, migrationId, 'Preparing corrected file upload')
  await clearMigrationUploads(db, migrationId, actorId)

  const {
    cancel_reason: _cancelReason,
    cancelled_at: _cancelledAt,
    import_error: _importError,
    failed_at: _failedAt,
    ...errorSummaryRest
  } = project.error_summary

  return updateMigrationProject(
    db,
    migrationId,
    {
      status: 'draft',
      current_stage: 2,
      progress_pct: 0,
      validation_status: 'pending',
      rollback_available: false,
      error_summary: errorSummaryRest,
      last_parsed_at: null,
      last_validated_at: null,
      wizard_state: {
        ...project.wizard_state,
        stage: 2,
        last_retry_at: new Date().toISOString(),
        previous_attempt: {
          retried_at: new Date().toISOString(),
          previous_status: project.status,
          cancel_reason: project.error_summary?.cancel_reason ?? null,
          import_error: project.error_summary?.import_error ?? null,
        },
      },
    },
    actorId,
    'migration.retried'
  )
}

/** Stop background jobs (cancelled, completed, user-cancelled failed). */
export function isMigrationAborted(project: MigrationProject): boolean {
  if (project.status === 'failed' && !isMigrationUserCancelled(project)) return false
  return isMigrationTerminal(project.status)
}

function mapProject(r: Record<string, unknown>): MigrationProject {
  return {
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string) ?? null,
    status: r.status as MigrationStatus,
    current_stage: Number(r.current_stage),
    progress_pct: Number(r.progress_pct),
    validation_status: r.validation_status as MigrationProject['validation_status'],
    rollback_available: Boolean(r.rollback_available),
    wizard_state: (r.wizard_state as Record<string, unknown>) ?? {},
    dependency_graph: (r.dependency_graph as MigrationProject['dependency_graph']) ?? [],
    import_order: (r.import_order as MigrationEntityType[]) ?? [],
    preview_summary: (r.preview_summary as Record<string, unknown>) ?? {},
    reconciliation: (r.reconciliation as Record<string, unknown>) ?? {},
    error_summary: (r.error_summary as Record<string, unknown>) ?? {},
    warning_summary: (r.warning_summary as Record<string, unknown>) ?? {},
    files_uploaded: Number(r.files_uploaded ?? 0),
    error_count: Number(r.error_count ?? 0),
    warning_count: Number(r.warning_count ?? 0),
    created_by: (r.created_by as string) ?? null,
    approved_by: (r.approved_by as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    started_at: r.started_at ? String(r.started_at) : null,
    last_activity_at: String(r.last_activity_at),
    completed_at: r.completed_at ? String(r.completed_at) : null,
    archived_at: r.archived_at ? String(r.archived_at) : null,
    last_parsed_at: r.last_parsed_at ? String(r.last_parsed_at) : null,
    last_validated_at: r.last_validated_at ? String(r.last_validated_at) : null,
  }
}

export async function touchMigration(db: Db, migrationId: string) {
  await db.query(
    `UPDATE public.migration_projects
     SET last_activity_at = now(), updated_at = now()
     WHERE id = $1`,
    [migrationId]
  )
}

export async function createMigrationProject(
  db: Db,
  params: { name: string; description?: string; createdBy: string }
): Promise<MigrationProject> {
  const { rows } = await db.query(
    `INSERT INTO public.migration_projects (name, description, created_by, wizard_state, started_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     RETURNING *`,
    [
      params.name.trim(),
      params.description?.trim() || null,
      params.createdBy,
      JSON.stringify({ stage: 1, created: true }),
    ]
  )
  const project = mapProject(rows[0])
  await writeMigrationAudit(db, {
    migrationId: project.id,
    actorId: params.createdBy,
    action: 'migration.created',
    stage: 1,
    details: { name: project.name },
  })
  return project
}

export async function getMigrationProject(db: Db, id: string): Promise<MigrationProject | null> {
  const { rows } = await db.query(`SELECT * FROM public.migration_projects WHERE id = $1`, [id])
  return rows[0] ? mapProject(rows[0]) : null
}

export async function listMigrationProjects(
  db: Db,
  filter?: { status?: string; q?: string; limit?: number }
): Promise<MigrationProject[]> {
  const limit = filter?.limit ?? 100
  const params: unknown[] = []
  const where: string[] = [`status <> 'archived'`]
  if (filter?.status === 'failed') {
    where.push(`(
      status IN ('failed', 'cancelled')
      OR (status = 'draft' AND error_summary->>'cancel_reason' IS NOT NULL)
    )`)
  } else if (filter?.status) {
    params.push(filter.status)
    where.push(`status = $${params.length}`)
  }
  if (filter?.q) {
    params.push(`%${filter.q}%`)
    where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`)
  }
  params.push(limit)
  const { rows } = await db.query(
    // Sorted by created_at (the date the migration was uploaded/started), not last_activity_at —
    // last_activity_at changes every time a background job touches the project (parse, validate,
    // reconcile, ...), which used to reshuffle the list's order out from under whoever was looking
    // at it. created_at is fixed once the project exists, so the list order stays stable.
    `SELECT * FROM public.migration_projects
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  )
  return rows.map(mapProject)
}

export async function updateMigrationProject(
  db: Db,
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    status: MigrationStatus
    current_stage: number
    progress_pct: number
    validation_status: MigrationProject['validation_status']
    rollback_available: boolean
    wizard_state: Record<string, unknown>
    dependency_graph: unknown
    import_order: unknown
    preview_summary: unknown
    reconciliation: unknown
    error_summary: unknown
    warning_summary: unknown
    files_uploaded: number
    error_count: number
    warning_count: number
    approved_by: string | null
    completed_at: string | null
    last_parsed_at: string | null
    last_validated_at: string | null
  }>,
  actorId?: string | null,
  auditAction?: string
): Promise<MigrationProject | null> {
  const fields: string[] = []
  const values: unknown[] = []
  const set = (col: string, val: unknown, json = false) => {
    values.push(json ? JSON.stringify(val) : val)
    fields.push(`${col} = $${values.length}${json ? '::jsonb' : ''}`)
  }

  if (patch.name !== undefined) set('name', patch.name)
  if (patch.description !== undefined) set('description', patch.description)
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.current_stage !== undefined) set('current_stage', patch.current_stage)
  if (patch.progress_pct !== undefined) set('progress_pct', patch.progress_pct)
  if (patch.validation_status !== undefined) set('validation_status', patch.validation_status)
  if (patch.rollback_available !== undefined) set('rollback_available', patch.rollback_available)
  if (patch.wizard_state !== undefined) {
    // Many call sites pass a small, stage-specific object (e.g. { stage: 6, validated_at }),
    // not the full accumulated state — a plain replace silently drops earlier keys like
    // validated_at/analysed_at/approved_at the next time any other stage writes wizard_state.
    // Merge at the SQL layer instead so every caller gets accumulation for free, without having
    // to remember to spread the previous value themselves.
    values.push(JSON.stringify(patch.wizard_state))
    fields.push(`wizard_state = wizard_state || $${values.length}::jsonb`)
  }
  if (patch.dependency_graph !== undefined) set('dependency_graph', patch.dependency_graph, true)
  if (patch.import_order !== undefined) set('import_order', patch.import_order, true)
  if (patch.preview_summary !== undefined) set('preview_summary', patch.preview_summary, true)
  if (patch.reconciliation !== undefined) set('reconciliation', patch.reconciliation, true)
  if (patch.error_summary !== undefined) set('error_summary', patch.error_summary, true)
  if (patch.warning_summary !== undefined) set('warning_summary', patch.warning_summary, true)
  if (patch.files_uploaded !== undefined) set('files_uploaded', patch.files_uploaded)
  if (patch.error_count !== undefined) set('error_count', patch.error_count)
  if (patch.warning_count !== undefined) set('warning_count', patch.warning_count)
  if (patch.approved_by !== undefined) set('approved_by', patch.approved_by)
  if (patch.completed_at !== undefined) set('completed_at', patch.completed_at)
  if (patch.last_parsed_at !== undefined) set('last_parsed_at', patch.last_parsed_at)
  if (patch.last_validated_at !== undefined) set('last_validated_at', patch.last_validated_at)

  if (!fields.length) return getMigrationProject(db, id)

  fields.push(`updated_at = now()`, `last_activity_at = now()`)
  values.push(id)

  const { rows } = await db.query(
    `UPDATE public.migration_projects SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  )
  const project = rows[0] ? mapProject(rows[0]) : null
  if (project && auditAction) {
    await writeMigrationAudit(db, {
      migrationId: id,
      actorId: actorId ?? null,
      action: auditAction,
      stage: project.current_stage,
      details: patch as Record<string, unknown>,
    })
  }
  return project
}

export async function migrationHasProductionImports(db: Db, migrationId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM public.migration_staging_rows
     WHERE migration_id = $1 AND production_id IS NOT NULL
     LIMIT 1`,
    [migrationId]
  )
  return Boolean(rows[0])
}

export async function deleteMigrationProject(
  db: Db,
  id: string,
  actorId: string
): Promise<void> {
  const project = await getMigrationProject(db, id)
  if (!project) throw new Error('Migration not found')
  if (!canDeleteMigration(project)) {
    throw new Error('Only failed or cancelled migrations can be deleted')
  }
  if (await migrationHasProductionImports(db, id)) {
    throw new Error(
      'This migration imported data into production. Roll back the import before deleting.'
    )
  }
  if (['importing', 'analysing', 'verifying'].includes(project.status)) {
    throw new Error('Cannot delete a migration while it is still running')
  }

  await cancelMigrationJobs(db, id, 'Migration deleted')
  await writeAuditLog(db, {
    actor_id: actorId,
    action: 'migration.deleted',
    module: 'historical_migrations',
    target_id: id,
    target_label: project.name,
    metadata: {
      status: project.status,
      cancel_reason: project.error_summary?.cancel_reason ?? null,
    },
  })
  await db.query(`DELETE FROM public.migration_projects WHERE id = $1`, [id])
}

export async function saveWizardState(
  db: Db,
  id: string,
  stage: number,
  state: Record<string, unknown>,
  actorId?: string | null
) {
  const existing = await getMigrationProject(db, id)
  if (!existing) return null
  const wizard_state = { ...existing.wizard_state, ...state, stage }
  const syncProgress = !['importing', 'completed', 'rolled_back'].includes(existing.status)
  return updateMigrationProject(
    db,
    id,
    {
      current_stage: stage,
      wizard_state,
      ...(syncProgress ? { progress_pct: migrationProgressForStage(stage, existing.status) } : {}),
    },
    actorId,
    'migration.wizard_saved'
  )
}
