import { describe, expect, it } from 'vitest'
import { canDeleteMigration, canRestartMigration, isMigrationUserCancelled, needsMigrationRetry } from '@/lib/migration/lifecycle'
import type { MigrationProject } from '@/lib/migration/types'

function project(overrides: Partial<MigrationProject>): MigrationProject {
  return {
    id: '1',
    name: 'Test',
    description: null,
    status: 'draft',
    current_stage: 1,
    progress_pct: 0,
    validation_status: 'pending',
    rollback_available: false,
    wizard_state: {},
    dependency_graph: [],
    import_order: [],
    preview_summary: {},
    reconciliation: {},
    error_summary: {},
    warning_summary: {},
    files_uploaded: 0,
    error_count: 0,
    warning_count: 0,
    created_by: null,
    approved_by: null,
    created_at: '',
    updated_at: '',
    started_at: null,
    last_activity_at: '',
    completed_at: null,
    archived_at: null,
    ...overrides,
  }
}

describe('migration lifecycle', () => {
  it('detects user-cancelled migrations', () => {
    expect(isMigrationUserCancelled(project({ error_summary: { cancel_reason: 'Wrong files' } }))).toBe(true)
    expect(isMigrationUserCancelled(project({ error_summary: {} }))).toBe(false)
  })

  it('allows delete for failed, cancelled, and user-cancelled migrations', () => {
    expect(canDeleteMigration(project({ status: 'failed' }))).toBe(true)
    expect(canDeleteMigration(project({ status: 'cancelled' }))).toBe(true)
    expect(canDeleteMigration(project({
      status: 'draft',
      error_summary: { cancel_reason: 'No longer needed' },
    }))).toBe(true)
  })

  it('detects when a retry is needed after cancel or rollback', () => {
    expect(needsMigrationRetry(project({ status: 'rolled_back' }))).toBe(true)
    expect(needsMigrationRetry(project({
      status: 'draft',
      error_summary: { cancel_reason: 'Wrong vendor list' },
    }))).toBe(true)
    expect(needsMigrationRetry(project({ status: 'failed', error_summary: { import_error: 'x' } }))).toBe(false)
  })

  it('allows restart only for cancelled or rolled-back attempts', () => {
    expect(canRestartMigration(project({ status: 'rolled_back' }))).toBe(true)
    expect(canRestartMigration(project({
      status: 'draft',
      error_summary: { cancel_reason: 'Fixing data' },
    }))).toBe(true)
    expect(canRestartMigration(project({ status: 'failed', error_summary: { import_error: 'x' } }))).toBe(false)
  })

  it('blocks delete for active or completed migrations', () => {
    expect(canDeleteMigration(project({ status: 'draft' }))).toBe(false)
    expect(canDeleteMigration(project({ status: 'importing' }))).toBe(false)
    expect(canDeleteMigration(project({ status: 'completed' }))).toBe(false)
    expect(canDeleteMigration(project({ status: 'rolled_back' }))).toBe(false)
  })
})
