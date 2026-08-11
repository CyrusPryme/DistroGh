type ProjectLike = {
  status: string
  error_summary?: Record<string, unknown> | null
}

/** User cancelled — further work blocked until they explicitly retry. */
export function isMigrationUserCancelled(project: ProjectLike): boolean {
  return Boolean(project.error_summary?.cancel_reason)
}

/** Stopped attempt (cancelled or rolled back) — admin must reset before uploading again. */
export function needsMigrationRetry(project: ProjectLike): boolean {
  if (project.status === 'rolled_back') return true
  if (isMigrationUserCancelled(project)) return true
  return false
}

/** Whether the workspace can be cleared for a fresh upload pass. */
export function canRestartMigration(project: ProjectLike): boolean {
  if (project.status === 'rolled_back') return true
  if (isMigrationUserCancelled(project)) return true
  return false
}

/** Whether this migration may be permanently removed. */
export function canDeleteMigration(project: ProjectLike): boolean {
  if (project.status === 'failed' || project.status === 'cancelled') return true
  if (isMigrationUserCancelled(project)) return true
  return false
}

type FreshnessLike = {
  last_parsed_at?: string | null
  last_validated_at?: string | null
}

/**
 * True when files were (re-)parsed after the last successful validation — meaning the current
 * staging rows have never been validated in their current form (parsing always resets
 * validation_status back to 'pending'). Approve / Start Import must be blocked in this state:
 * otherwise Start Import silently finds zero eligible rows, enqueues nothing, and Reconcile
 * reports "0 expected / 0 imported" as balanced — a migration can reach "completed" having
 * imported nothing at all.
 */
export function needsRevalidation(project: FreshnessLike): boolean {
  if (!project.last_parsed_at) return false
  if (!project.last_validated_at) return true
  return new Date(project.last_parsed_at).getTime() > new Date(project.last_validated_at).getTime()
}
