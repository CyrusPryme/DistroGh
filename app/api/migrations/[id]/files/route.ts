import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import { attachMigrationFile, listMigrationFiles, replaceMigrationFile, setFileEntityType, removeMigrationFile } from '@/lib/migration/files'
import type { MigrationEntityType } from '@/lib/migration/types'
import { enqueueJob } from '@/lib/migration/jobs'
import { processMigrationJobs } from '@/lib/migration/process'
import { getMigrationProject, isMigrationWorkBlocked, isMigrationUserCancelled } from '@/lib/migration/projects'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('historical_migrations', 'read')
    const { id } = await ctx.params
    const files = await listMigrationFiles(getDbPool(), id)
    return NextResponse.json({ success: true, data: files })
  } catch (e) {
    return apiError(e, 'Failed to list files')
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('historical_migrations', 'create')
    const { id } = await ctx.params
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }
    const name = file.name.toLowerCase()
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      return NextResponse.json({ success: false, error: 'Only xlsx, xls, csv supported' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const entityType = (form.get('entity_type') as MigrationEntityType | null) || null
    const replaceFileId = (form.get('replace_file_id') as string | null) || null
    const pool = getDbPool()

    const project = await getMigrationProject(pool, id)
    if (!project) {
      return NextResponse.json({ success: false, error: 'Migration not found' }, { status: 404 })
    }
    if (isMigrationWorkBlocked(project)) {
      let error = 'Cannot upload files to this migration.'
      if (isMigrationUserCancelled(project)) {
        error = 'This migration was cancelled. Click "Start over with new files" first.'
      } else if (['completed', 'rolled_back', 'archived', 'cancelled'].includes(project.status)) {
        error = 'This migration is finished. Start over with new files or create a new migration project.'
      }
      return NextResponse.json({ success: false, error }, { status: 400 })
    }
    if (project.status === 'importing') {
      return NextResponse.json(
        { success: false, error: 'Cannot upload files while import is running' },
        { status: 400 }
      )
    }

    const saved = replaceFileId
      ? await replaceMigrationFile(pool, {
          migrationId: id,
          replaceFileId,
          filename: file.name,
          mimeType: file.type,
          buffer,
          actorId: session.user_id,
        })
      : await attachMigrationFile(pool, {
          migrationId: id,
          filename: file.name,
          mimeType: file.type,
          buffer,
          entityType,
          actorId: session.user_id,
        })

    // Auto-enqueue parse for this migration
    await enqueueJob(pool, {
      migrationId: id,
      jobType: 'parse',
      actorId: session.user_id,
    })
    // Kick worker (non-blocking best-effort)
    processMigrationJobs(pool, { maxJobs: 2 }).catch(() => {})

    return NextResponse.json({ success: true, data: saved })
  } catch (e) {
    return apiError(e, 'Failed to upload file')
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('historical_migrations', 'update')
    const { id } = await ctx.params
    const body = await req.json()
    if (!body.file_id || !body.entity_type) {
      return NextResponse.json({ success: false, error: 'file_id and entity_type required' }, { status: 400 })
    }
    const file = await setFileEntityType(
      getDbPool(),
      String(body.file_id),
      body.entity_type as MigrationEntityType,
      session.user_id
    )
    return NextResponse.json({ success: true, data: { migration_id: id, file } })
  } catch (e) {
    return apiError(e, 'Failed to update file')
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePermission('historical_migrations', 'update')
    const { id } = await ctx.params
    const body = await req.json()
    const fileId = String(body.file_id || '')
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'file_id is required' }, { status: 400 })
    }

    const pool = getDbPool()
    const project = await getMigrationProject(pool, id)
    if (!project) {
      return NextResponse.json({ success: false, error: 'Migration not found' }, { status: 404 })
    }
    if (project.status === 'importing') {
      return NextResponse.json(
        { success: false, error: 'Cannot remove files while import is running' },
        { status: 400 }
      )
    }
    if (['completed', 'rolled_back', 'archived'].includes(project.status)) {
      return NextResponse.json(
        { success: false, error: 'Cannot remove files from a finished migration' },
        { status: 400 }
      )
    }

    await removeMigrationFile(pool, {
      migrationId: id,
      fileId,
      actorId: session.user_id,
    })
    const files = await listMigrationFiles(pool, id)
    return NextResponse.json({ success: true, data: files })
  } catch (e) {
    return apiError(e, 'Failed to remove file')
  }
}
