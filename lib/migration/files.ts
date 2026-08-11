import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { MigrationEntityType, MigrationFile } from '@/lib/migration/types'
import { detectEntityType } from '@/lib/migration/detect'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { touchMigration } from '@/lib/migration/projects'

type Db = Pool | PoolClient

function mapFile(r: Record<string, unknown>): MigrationFile {
  return {
    id: String(r.id),
    migration_id: String(r.migration_id),
    entity_type: (r.entity_type as MigrationEntityType) ?? null,
    original_filename: String(r.original_filename),
    mime_type: (r.mime_type as string) ?? null,
    size_bytes: Number(r.size_bytes ?? 0),
    checksum_sha256: (r.checksum_sha256 as string) ?? null,
    parse_status: String(r.parse_status),
    parse_error: (r.parse_error as string) ?? null,
    row_count: Number(r.row_count ?? 0),
    sheet_names: (r.sheet_names as string[]) ?? [],
    detected_columns: (r.detected_columns as string[]) ?? [],
    uploaded_at: String(r.uploaded_at),
    is_active: Boolean(r.is_active),
  }
}

export async function listMigrationFiles(db: Db, migrationId: string): Promise<MigrationFile[]> {
  const { rows } = await db.query(
    `SELECT * FROM public.migration_files
     WHERE migration_id = $1 AND is_active = true
     ORDER BY uploaded_at ASC`,
    [migrationId]
  )
  return rows.map(mapFile)
}

export async function getFileBlob(db: Db, fileId: string): Promise<Buffer | null> {
  const { rows } = await db.query(
    `SELECT content FROM public.migration_file_blobs WHERE file_id = $1`,
    [fileId]
  )
  if (!rows[0]?.content) return null
  return Buffer.from(rows[0].content)
}

/**
 * Persist uploaded workbook/CSV bytes into DB (durable across deploys).
 */
export async function attachMigrationFile(
  db: Pool,
  params: {
    migrationId: string
    filename: string
    mimeType?: string
    buffer: Buffer
    entityType?: MigrationEntityType | null
    actorId?: string | null
    columnsHint?: string[]
  }
): Promise<MigrationFile> {
  const checksum = createHash('sha256').update(params.buffer).digest('hex')
  const entity =
    params.entityType ??
    detectEntityType(params.filename, params.columnsHint ?? [])

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO public.migration_files
        (migration_id, entity_type, original_filename, mime_type, size_bytes, checksum_sha256, detected_columns)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING *`,
      [
        params.migrationId,
        entity,
        params.filename,
        params.mimeType ?? null,
        params.buffer.length,
        checksum,
        JSON.stringify(params.columnsHint ?? []),
      ]
    )
    const file = mapFile(rows[0])
    await client.query(
      `INSERT INTO public.migration_file_blobs (file_id, content) VALUES ($1, $2)`,
      [file.id, params.buffer]
    )
    await client.query(
      `UPDATE public.migration_projects
       SET files_uploaded = (
         SELECT COUNT(*)::int FROM public.migration_files WHERE migration_id = $1 AND is_active
       ),
       last_activity_at = now(), updated_at = now()
       WHERE id = $1`,
      [params.migrationId]
    )
    await writeMigrationAudit(client, {
      migrationId: params.migrationId,
      actorId: params.actorId,
      action: 'migration.file_uploaded',
      stage: 2,
      details: { file_id: file.id, filename: params.filename, entity_type: entity, size: params.buffer.length },
    })
    await client.query('COMMIT')
    return file
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function replaceMigrationFile(
  db: Pool,
  params: {
    migrationId: string
    replaceFileId: string
    filename: string
    mimeType?: string
    buffer: Buffer
    actorId?: string | null
  }
): Promise<MigrationFile> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const old = await client.query(
      `SELECT * FROM public.migration_files WHERE id = $1 AND migration_id = $2 AND is_active`,
      [params.replaceFileId, params.migrationId]
    )
    if (!old.rows[0]) throw new Error('File not found')

    await client.query(
      `UPDATE public.migration_files SET is_active = false, replaced_at = now(), parse_status = 'replaced'
       WHERE id = $1`,
      [params.replaceFileId]
    )
    // Clear staging rows for old file
    await client.query(
      `DELETE FROM public.migration_staging_rows WHERE migration_id = $1 AND file_id = $2`,
      [params.migrationId, params.replaceFileId]
    )

    const checksum = createHash('sha256').update(params.buffer).digest('hex')
    const entity = (old.rows[0].entity_type as MigrationEntityType) ?? detectEntityType(params.filename, [])
    const { rows } = await client.query(
      `INSERT INTO public.migration_files
        (migration_id, entity_type, original_filename, mime_type, size_bytes, checksum_sha256, replaced_by_file_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        params.migrationId,
        entity,
        params.filename,
        params.mimeType ?? null,
        params.buffer.length,
        checksum,
        null,
      ]
    )
    const file = mapFile(rows[0])
    await client.query(
      `UPDATE public.migration_files SET replaced_by_file_id = $1 WHERE id = $2`,
      [file.id, params.replaceFileId]
    )
    await client.query(
      `INSERT INTO public.migration_file_blobs (file_id, content) VALUES ($1, $2)`,
      [file.id, params.buffer]
    )
    await touchMigration(client, params.migrationId)
    await writeMigrationAudit(client, {
      migrationId: params.migrationId,
      actorId: params.actorId,
      action: 'migration.file_replaced',
      stage: 2,
      details: { old_file_id: params.replaceFileId, new_file_id: file.id },
    })
    await client.query('COMMIT')
    return file
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function setFileEntityType(
  db: Db,
  fileId: string,
  entityType: MigrationEntityType,
  actorId?: string | null
) {
  const { rows } = await db.query(
    `UPDATE public.migration_files SET entity_type = $2 WHERE id = $1 RETURNING *`,
    [fileId, entityType]
  )
  if (rows[0]) {
    await writeMigrationAudit(db, {
      migrationId: String(rows[0].migration_id),
      actorId,
      action: 'migration.file_entity_assigned',
      stage: 2,
      details: { file_id: fileId, entity_type: entityType },
    })
  }
  return rows[0] ? mapFile(rows[0]) : null
}

async function refreshFilesUploadedCount(db: Db, migrationId: string) {
  await db.query(
    `UPDATE public.migration_projects
     SET files_uploaded = (
       SELECT COUNT(*)::int FROM public.migration_files WHERE migration_id = $1 AND is_active
     ),
     last_activity_at = now(), updated_at = now()
     WHERE id = $1`,
    [migrationId]
  )
}

/** Remove one uploaded file and its staging rows. */
export async function removeMigrationFile(
  db: Pool,
  params: { migrationId: string; fileId: string; actorId?: string | null }
): Promise<void> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT * FROM public.migration_files
       WHERE id = $1 AND migration_id = $2 AND is_active`,
      [params.fileId, params.migrationId]
    )
    if (!rows[0]) throw new Error('File not found')

    await client.query(
      `UPDATE public.migration_files
       SET is_active = false, replaced_at = now(), parse_status = 'replaced'
       WHERE id = $1`,
      [params.fileId]
    )
    await client.query(
      `DELETE FROM public.migration_staging_rows WHERE migration_id = $1 AND file_id = $2`,
      [params.migrationId, params.fileId]
    )
    await refreshFilesUploadedCount(client, params.migrationId)
    await writeMigrationAudit(client, {
      migrationId: params.migrationId,
      actorId: params.actorId,
      action: 'migration.file_removed',
      stage: 2,
      details: { file_id: params.fileId, filename: rows[0].original_filename },
    })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/** Clear all uploads and staging so the migration can start fresh. */
export async function clearMigrationUploads(
  db: Pool,
  migrationId: string,
  actorId?: string | null
): Promise<number> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE public.migration_files
       SET is_active = false, replaced_at = now(), parse_status = 'replaced'
       WHERE migration_id = $1 AND is_active
       RETURNING id`,
      [migrationId]
    )
    await client.query(`DELETE FROM public.migration_staging_rows WHERE migration_id = $1`, [migrationId])
    await client.query(`DELETE FROM public.migration_entity_mappings WHERE migration_id = $1`, [migrationId])
    await client.query(
      `UPDATE public.migration_projects
       SET files_uploaded = 0,
           error_count = 0,
           warning_count = 0,
           validation_status = 'pending',
           dependency_graph = '[]'::jsonb,
           import_order = '[]'::jsonb,
           preview_summary = '{}'::jsonb,
           reconciliation = '{}'::jsonb,
           progress_pct = 0,
           current_stage = 2,
           last_parsed_at = NULL,
           last_validated_at = NULL,
           last_activity_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [migrationId]
    )
    if (rows.length) {
      await writeMigrationAudit(client, {
        migrationId,
        actorId,
        action: 'migration.uploads_cleared',
        stage: 2,
        details: { files_removed: rows.length },
      })
    }
    await client.query('COMMIT')
    return rows.length
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
