import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import {
  getMigrationProject,
  saveWizardState,
  updateMigrationProject,
} from '@/lib/migration/projects'
import { listMigrationFiles } from '@/lib/migration/files'
import { listJobs } from '@/lib/migration/jobs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('historical_migrations', 'read')
    const { id } = await ctx.params
    const pool = getDbPool()
    const project = await getMigrationProject(pool, id)
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    const [files, jobs, audit] = await Promise.all([
      listMigrationFiles(pool, id),
      listJobs(pool, id),
      pool.query(
        `SELECT id, action, stage, details, created_at, actor_id
         FROM public.migration_audit_events
         WHERE migration_id = $1
         ORDER BY created_at DESC LIMIT 100`,
        [id]
      ),
    ])
    return NextResponse.json({
      success: true,
      data: { project, files, jobs, audit: audit.rows },
    })
  } catch (e) {
    return apiError(e, 'Failed to load migration')
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('historical_migrations', 'update')
    const { id } = await ctx.params
    const body = await req.json()
    const pool = getDbPool()

    if (body.wizard_state || body.current_stage) {
      const project = await saveWizardState(
        pool,
        id,
        Number(body.current_stage || body.wizard_state?.stage || 1),
        body.wizard_state || {},
        session.user_id
      )
      return NextResponse.json({ success: true, data: project })
    }

    const project = await updateMigrationProject(
      pool,
      id,
      {
        name: body.name,
        description: body.description,
        status: body.status,
        current_stage: body.current_stage,
      },
      session.user_id,
      'migration.updated'
    )
    return NextResponse.json({ success: true, data: project })
  } catch (e) {
    return apiError(e, 'Failed to update migration')
  }
}
