import type { Pool, PoolClient } from 'pg'
import type { SessionPayload } from '@/lib/auth/session'

export interface AuditEntry {
  actor_id?: string | null
  actor_email?: string | null
  action: string
  module: string
  target_id?: string | null
  target_label?: string | null
  metadata?: Record<string, unknown> | null
  ip_address?: string | null
}

/**
 * Write one audit log entry using an existing client (inside a transaction)
 * or a pool (gets its own connection).
 */
export async function writeAuditLog(
  db: Pool | PoolClient,
  entry: AuditEntry
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO public.audit_logs
        (actor_id, actor_email, action, module, target_id, target_label, metadata, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.actor_id ?? null,
        entry.actor_email ?? null,
        entry.action,
        entry.module,
        entry.target_id ?? null,
        entry.target_label ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.ip_address ?? null,
      ]
    )
  } catch {
    // Audit failures must never break the main operation.
  }
}

/**
 * Convenience: extract actor fields from a session payload.
 */
export function actorFromSession(session: SessionPayload) {
  return {
    actor_id: session.user_id,
    actor_email: session.email,
  }
}

/**
 * Extract client IP from a Request object (handles X-Forwarded-For).
 */
export function ipFromRequest(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return null
}
