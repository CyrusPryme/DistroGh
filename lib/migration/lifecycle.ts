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
