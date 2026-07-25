import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import { enqueueJob, listJobs, cancelMigrationJobs } from '@/lib/migration/jobs'
import { buildPreviewSummary, processMigrationJobs } from '@/lib/migration/process'
import { getMigrationProject, updateMigrationProject, isMigrationTerminal } from '@/lib/migration/projects'
import { CANONICAL_IMPORT_ORDER } from '@/lib/migration/entities'
import type { MigrationEntityType } from '@/lib/migration/types'
import { writeMigrationAudit } from '@/lib/migration/audit'

type Action =
  | 'analyse'
  | 'parse'
  | 'validate'
  | 'preview'
  | 'approve'
  | 'start_import'
  | 'reconcile'
  | 'rollback'
  | 'cancel'
  | 'archive'
  | 'process'
  | 'correct_row'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('historical_migrations', 'update')
    const { id } = await ctx.params
    const body = await req.json()
    const action = String(body.action || '') as Action
    const pool = getDbPool()
    const project = await getMigrationProject(pool, id)
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    if (action !== 'cancel' && isMigrationTerminal(project.status)) {
      return NextResponse.json(
        { success: false, error: 'Migration is no longer active' },
        { status: 400 }
      )
    }

    if (action === 'correct_row') {
      const rowId = String(body.row_id || '')
      const corrections = body.corrections || {}
      const resolved_refs = body.resolved_refs || {}
      await pool.query(
        `UPDATE public.migration_staging_rows
         SET corrections = corrections || $2::jsonb,
             resolved_refs = resolved_refs || $3::jsonb,
             validation_status = 'corrected',
             updated_at = now()
         WHERE id = $1 AND migration_id = $4`,
        [rowId, JSON.stringify(corrections), JSON.stringify(resolved_refs), id]
      )
      await writeMigrationAudit(pool, {
        migrationId: id,
        actorId: session.user_id,
        action: 'migration.row_corrected',
        stage: 5,
        details: { row_id: rowId },
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'preview') {
      const summary = await buildPreviewSummary(pool, id)
      return NextResponse.json({ success: true, data: summary })
    }

    if (action === 'approve') {
      await requirePermission('historical_migrations', 'approve')
      const updated = await updateMigrationProject(
        pool,
        id,
        {
          status: 'approved',
          current_stage: 7,
          approved_by: session.user_id,
          wizard_state: { stage: 7, approved_at: new Date().toISOString() },
        },
        session.user_id,
        'migration.approved'
      )
      return NextResponse.json({ success: true, data: updated })
    }

    if (action === 'cancel') {
      const reason = String(body.reason || '').trim()
      if (!reason) {
        return NextResponse.json(
          { success: false, error: 'Cancellation reason is required' },
          { status: 400 }
        )
      }
      if (isMigrationTerminal(project.status)) {
        return NextResponse.json(
          { success: false, error: 'Migration is already finished' },
          { status: 400 }
        )
      }

      const cancelledJobs = await cancelMigrationJobs(pool, id, reason)
      const cancelledAt = new Date().toISOString()
      const updated = await updateMigrationProject(
        pool,
        id,
        {
          status: 'failed',
          error_summary: {
            ...project.error_summary,
            cancel_reason: reason,
            cancelled_at: cancelledAt,
            cancelled_by: session.user_id,
            cancelled_at_stage: project.current_stage,
            cancelled_jobs: cancelledJobs,
          },
          wizard_state: {
            ...project.wizard_state,
            cancelled_at: cancelledAt,
            cancel_reason: reason,
          },
        },
        session.user_id,
        'migration.cancelled'
      )
      await writeMigrationAudit(pool, {
        migrationId: id,
        actorId: session.user_id,
        action: 'migration.failed',
        stage: project.current_stage,
        details: {
          reason,
          cancelled_jobs: cancelledJobs,
          previous_status: project.status,
        },
      })
      return NextResponse.json({ success: true, data: { project: updated, cancelled_jobs: cancelledJobs } })
    }

    if (action === 'archive') {
      const updated = await updateMigrationProject(
        pool,
        id,
        { status: 'archived' },
        session.user_id,
        'migration.archived'
      )
      return NextResponse.json({ success: true, data: updated })
    }

    if (action === 'start_import') {
      await requirePermission('historical_migrations', 'approve')
      if (project.status !== 'approved' && project.status !== 'ready') {
        return NextResponse.json(
          { success: false, error: 'Migration must be approved before import' },
          { status: 400 }
        )
      }
      const order = (project.import_order.length
        ? project.import_order
        : CANONICAL_IMPORT_ORDER) as MigrationEntityType[]

      for (const entity of order) {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
           WHERE migration_id = $1 AND entity_type = $2
             AND production_id IS NULL
             AND validation_status IN ('valid','warning','corrected')
             AND intended_action <> 'skip'`,
          [id, entity]
        )
        if (rows[0].c > 0) {
          await enqueueJob(pool, {
            migrationId: id,
            jobType: 'import',
            entityType: entity,
            totalRecords: rows[0].c,
            actorId: session.user_id,
          })
        }
      }
      await enqueueJob(pool, { migrationId: id, jobType: 'reconcile', actorId: session.user_id })
      await updateMigrationProject(pool, id, {
        status: 'importing',
        current_stage: 8,
        progress_pct: 5,
      })
      processMigrationJobs(pool, { maxJobs: 5 }).catch(() => {})
      return NextResponse.json({ success: true, data: { jobs: await listJobs(pool, id) } })
    }

    if (action === 'process') {
      const results = await processMigrationJobs(pool, { maxJobs: Number(body.max_jobs || 5) })
      return NextResponse.json({ success: true, data: results })
    }

    const jobTypeMap: Record<string, 'analyse' | 'parse' | 'validate' | 'reconcile' | 'rollback'> = {
      analyse: 'analyse',
      parse: 'parse',
      validate: 'validate',
      reconcile: 'reconcile',
      rollback: 'rollback',
    }
    const jobType = jobTypeMap[action]
    if (!jobType) {
      return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 })
    }

    if (jobType === 'rollback') {
      await requirePermission('historical_migrations', 'manage')
    }

    const job = await enqueueJob(pool, {
      migrationId: id,
      jobType,
      actorId: session.user_id,
    })
    processMigrationJobs(pool, { maxJobs: 3 }).catch(() => {})
    return NextResponse.json({ success: true, data: job })
  } catch (e) {
    return apiError(e, 'Migration action failed')
  }
}
