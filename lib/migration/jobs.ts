import type { Pool, PoolClient } from 'pg'
import type { JobType, MigrationEntityType, MigrationJob } from '@/lib/migration/types'
import { writeMigrationAudit } from '@/lib/migration/audit'

type Db = Pool | PoolClient

function mapJob(r: Record<string, unknown>): MigrationJob {
  return {
    id: String(r.id),
    migration_id: String(r.migration_id),
    job_type: r.job_type as JobType,
    entity_type: (r.entity_type as MigrationEntityType) ?? null,
    status: r.status as MigrationJob['status'],
    progress_pct: Number(r.progress_pct),
    current_record: Number(r.current_record),
    total_records: Number(r.total_records),
    chunk_size: Number(r.chunk_size),
    last_cursor: (r.last_cursor as string) ?? null,
    error_message: (r.error_message as string) ?? null,
    result_summary: (r.result_summary as Record<string, unknown>) ?? {},
  }
}

export async function enqueueJob(
  db: Db,
  params: {
    migrationId: string
    jobType: JobType
    entityType?: MigrationEntityType | null
    totalRecords?: number
    chunkSize?: number
    actorId?: string | null
  }
): Promise<MigrationJob> {
  // Overlapping duplicate jobs of the same type (e.g. two 'parse' jobs from a quick
  // double-upload, or repeated polling re-triggering 'validate') used to pile up with no
  // de-duplication — a later stray job could silently re-run and undo work a newer, already-
  // completed job had done (this is exactly how a validated migration ended up back at
  // 'pending' before Start Import ran). Re-use an already queued/running job instead.
  const { rows: existing } = await db.query(
    `SELECT * FROM public.migration_jobs
     WHERE migration_id = $1 AND job_type = $2 AND status IN ('queued','running')
       AND entity_type IS NOT DISTINCT FROM $3
     ORDER BY created_at ASC
     LIMIT 1`,
    [params.migrationId, params.jobType, params.entityType ?? null]
  )
  if (existing[0]) {
    return mapJob(existing[0])
  }

  const { rows } = await db.query(
    `INSERT INTO public.migration_jobs
      (migration_id, job_type, entity_type, total_records, chunk_size)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [
      params.migrationId,
      params.jobType,
      params.entityType ?? null,
      params.totalRecords ?? 0,
      params.chunkSize ?? 250,
    ]
  )
  const job = mapJob(rows[0])
  await writeMigrationAudit(db, {
    migrationId: params.migrationId,
    actorId: params.actorId,
    action: `migration.job_enqueued.${params.jobType}`,
    details: { job_id: job.id, entity_type: params.entityType },
  })
  return job
}

export async function claimNextJob(db: Pool, workerId: string): Promise<MigrationJob | null> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT * FROM public.migration_jobs
       WHERE status IN ('queued','paused')
          OR (status = 'running' AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    )
    if (!rows[0]) {
      await client.query('COMMIT')
      return null
    }
    const { rows: updated } = await client.query(
      `UPDATE public.migration_jobs
       SET status = 'running',
           locked_at = now(),
           locked_by = $2,
           started_at = COALESCE(started_at, now()),
           attempt_count = attempt_count + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [rows[0].id, workerId]
    )
    await client.query('COMMIT')
    return mapJob(updated[0])
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function updateJobProgress(
  db: Db,
  jobId: string,
  patch: Partial<{
    progress_pct: number
    current_record: number
    total_records: number
    last_cursor: string | null
    status: MigrationJob['status']
    error_message: string | null
    result_summary: Record<string, unknown>
  }>
) {
  const fields: string[] = []
  const values: unknown[] = []
  const set = (col: string, val: unknown, json = false) => {
    values.push(json ? JSON.stringify(val) : val)
    fields.push(`${col} = $${values.length}${json ? '::jsonb' : ''}`)
  }
  if (patch.progress_pct !== undefined) set('progress_pct', patch.progress_pct)
  if (patch.current_record !== undefined) set('current_record', patch.current_record)
  if (patch.total_records !== undefined) set('total_records', patch.total_records)
  if (patch.last_cursor !== undefined) set('last_cursor', patch.last_cursor)
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.error_message !== undefined) set('error_message', patch.error_message)
  if (patch.result_summary !== undefined) set('result_summary', patch.result_summary, true)
  if (patch.status === 'completed' || patch.status === 'failed' || patch.status === 'cancelled') {
    fields.push(`completed_at = now()`)
  }
  fields.push(`updated_at = now()`)
  values.push(jobId)
  await db.query(
    `UPDATE public.migration_jobs SET ${fields.join(', ')} WHERE id = $${values.length}`,
    values
  )
}

export async function listJobs(db: Db, migrationId: string): Promise<MigrationJob[]> {
  const { rows } = await db.query(
    `SELECT * FROM public.migration_jobs WHERE migration_id = $1 ORDER BY created_at ASC`,
    [migrationId]
  )
  return rows.map(mapJob)
}

export async function getJob(db: Db, jobId: string): Promise<MigrationJob | null> {
  const { rows } = await db.query(`SELECT * FROM public.migration_jobs WHERE id = $1`, [jobId])
  return rows[0] ? mapJob(rows[0]) : null
}

/** Cancel all pending jobs for a migration (queued, running, paused). */
export async function cancelMigrationJobs(
  db: Db,
  migrationId: string,
  reason: string
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE public.migration_jobs
     SET status = 'cancelled',
         error_message = $2,
         completed_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now()
     WHERE migration_id = $1
       AND status IN ('queued', 'running', 'paused')`,
    [migrationId, reason]
  )
  return rowCount ?? 0
}

/** Re-queue failed jobs so import can be retried after a fix. */
export async function resetFailedMigrationJobs(db: Db, migrationId: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE public.migration_jobs
     SET status = 'queued',
         error_message = NULL,
         locked_at = NULL,
         locked_by = NULL,
         completed_at = NULL,
         updated_at = now()
     WHERE migration_id = $1 AND status = 'failed'`,
    [migrationId]
  )
  return rowCount ?? 0
}
