import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import { attachMigrationFile, listMigrationFiles, replaceMigrationFile, setFileEntityType } from '@/lib/migration/files'
import type { MigrationEntityType } from '@/lib/migration/types'
import { enqueueJob } from '@/lib/migration/jobs'
import { processMigrationJobs } from '@/lib/migration/process'

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
