import type { Pool, PoolClient } from 'pg'
import { writeAuditLog } from '@/lib/rbac/audit'

type Db = Pool | PoolClient

export async function writeMigrationAudit(
  db: Db,
  params: {
    migrationId: string
    actorId?: string | null
    action: string
    stage?: number
    details?: Record<string, unknown>
  }
) {
  try {
    await db.query(
      `INSERT INTO public.migration_audit_events (migration_id, actor_id, action, stage, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        params.migrationId,
        params.actorId ?? null,
        params.action,
        params.stage ?? null,
        JSON.stringify(params.details ?? {}),
      ]
    )
  } catch {
    // never break primary flow
  }

  await writeAuditLog(db, {
    actor_id: params.actorId,
    action: params.action,
    module: 'historical_migrations',
    target_id: params.migrationId,
    metadata: { stage: params.stage, ...(params.details ?? {}) },
  })
}
