type ProjectLike = {
  status: string
  error_summary?: Record<string, unknown> | null
}

/** User cancelled — no further work allowed. */
export function isMigrationUserCancelled(project: ProjectLike): boolean {
  return Boolean(project.error_summary?.cancel_reason)
}

/** Whether this migration may be permanently removed. */
export function canDeleteMigration(project: ProjectLike): boolean {
  if (project.status === 'failed' || project.status === 'cancelled') return true
  if (isMigrationUserCancelled(project)) return true
  return false
}
