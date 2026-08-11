import { describe, expect, it } from 'vitest'
import { runRollback } from '@/lib/migration/process'
import { createMockClient } from './mock-pg-client'

/** runRollback takes a Pool; wrap our mock client so pool.connect() and pool.query() share state. */
function poolFrom(client: ReturnType<typeof createMockClient>) {
  return { connect: async () => client, query: client.query } as any
}

describe('runRollback — Scenario 13: migration rollback of a category change', () => {
  it('restores the previous category exactly, never leaving the product with a NULL/blank category', async () => {
    const client = createMockClient([
      { match: /FROM public\.migration_phase_results/, respond: () => ({ rows: [] }) },
      {
        match: /FROM public\.migration_category_changes/,
        respond: () => ({
          rows: [{ id: 'change-1', product_id: 'product-1', previous_category: 'Beverages' }],
        }),
      },
      {
        match: /UPDATE public\.products SET category/,
        respond: ({ params }) => {
          expect(params).toEqual(['product-1', 'Beverages'])
          return { rows: [] }
        },
      },
      { match: /UPDATE public\.migration_category_changes SET rolled_back_at/, respond: () => ({ rows: [] }) },
      { match: /UPDATE public\.migration_staging_rows/, respond: () => ({ rows: [] }) },
      { match: /DELETE FROM public\.migration_provenance/, respond: () => ({ rows: [] }) },
      { match: /INSERT INTO public\.migration_rollback_log/, respond: () => ({ rows: [] }) },
      { match: /FROM public\.migration_projects/, respond: () => ({ rows: [] }) },
    ])
    const pool = poolFrom(client)

    await runRollback(pool, 'MIG-1', 'actor-1')

    const updateCall = client.calledMatching(/UPDATE public\.products SET category/)
    expect(updateCall.length).toBe(1)
    expect(updateCall[0].params).toEqual(['product-1', 'Beverages'])

    // The rollback ledger is not lost — this migration's category changes are marked rolled back.
    expect(client.calledMatching(/UPDATE public\.migration_category_changes SET rolled_back_at/).length).toBe(1)

    // Idempotency ledger is cleared so a legitimate re-import after fixing the source data
    // is not silently blocked forever.
    const clearCall = client.calledMatching(/DELETE FROM public\.migration_provenance/)
    expect(clearCall[0].params).toEqual(['MIG-1'])
  })

  it('never cascade-deletes unrelated production data when a phase has no production_ids', async () => {
    const client = createMockClient([
      { match: /FROM public\.migration_phase_results/, respond: () => ({ rows: [] }) },
      { match: /FROM public\.migration_category_changes/, respond: () => ({ rows: [] }) },
      { match: /UPDATE public\.migration_staging_rows/, respond: () => ({ rows: [] }) },
      { match: /DELETE FROM public\.migration_provenance/, respond: () => ({ rows: [] }) },
      { match: /INSERT INTO public\.migration_rollback_log/, respond: () => ({ rows: [] }) },
      { match: /FROM public\.migration_projects/, respond: () => ({ rows: [] }) },
    ])
    const pool = poolFrom(client)

    await runRollback(pool, 'MIG-2')

    expect(client.calledMatching(/UPDATE public\.products SET deleted_at/).length).toBe(0)
    expect(client.calledMatching(/DELETE FROM public\.categories/).length).toBe(0)
  })
})
