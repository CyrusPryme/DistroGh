import { describe, expect, it } from 'vitest'
import { listMigrationProjects } from '@/lib/migration/projects'
import { createMockClient } from './mock-pg-client'

/**
 * Regression coverage: the historical migrations list used to be ordered by `last_activity_at`,
 * which is bumped by every background job (parse, validate, reconcile, ...) — so a migration
 * being actively worked on would jump around in the list instead of staying put. The list must
 * stay in a stable chronological order based on when each migration was actually uploaded/started
 * (`created_at`, which never changes after creation), not by whatever happened most recently.
 */
describe('listMigrationProjects — chronological order by upload date', () => {
  it('orders by created_at, not last_activity_at', async () => {
    const client = createMockClient([
      { match: /FROM public\.migration_projects/, respond: () => ({ rows: [] }) },
    ])
    await listMigrationProjects(client)
    const call = client.calledMatching(/FROM public\.migration_projects/)[0]
    expect(call.text).toMatch(/ORDER BY created_at DESC/)
    expect(call.text).not.toMatch(/ORDER BY last_activity_at/)
  })
})
