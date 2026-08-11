import { describe, expect, it } from 'vitest'
import { findExistingProvenance, recordProvenance, clearProvenanceForMigration } from '@/lib/migration/provenance'
import { createMockClient } from './mock-pg-client'

describe('migration provenance — Scenario 14: re-running the same migration must not duplicate data', () => {
  it('returns null when the source row has never been migrated', async () => {
    const client = createMockClient([{ match: /FROM public\.migration_provenance/, respond: () => ({ rows: [] }) }])
    const result = await findExistingProvenance(client, {
      entityType: 'sales',
      sourceFileChecksum: 'abc123',
      sourceSheet: 'January',
      sourceRowNumber: 482,
    })
    expect(result).toBeNull()
  })

  it('finds an already-migrated row by (entity_type, checksum, sheet, row_number) — not by migration_id', async () => {
    const client = createMockClient([
      {
        match: /FROM public\.migration_provenance/,
        respond: ({ params }) => {
          expect(params).toEqual(['sales', 'abc123', 'January', 482])
          return { rows: [{ production_id: 'sale-999', migration_id: 'MIG-2026-001' }] }
        },
      },
    ])
    const result = await findExistingProvenance(client, {
      entityType: 'sales',
      sourceFileChecksum: 'abc123',
      sourceSheet: 'January',
      sourceRowNumber: 482,
    })
    expect(result).toEqual({ productionId: 'sale-999', migrationId: 'MIG-2026-001' })
  })

  it('a brand new migration project pointed at the same spreadsheet is still blocked (keyed on file checksum, not migration_id)', async () => {
    const client = createMockClient([
      {
        match: /FROM public\.migration_provenance/,
        respond: () => ({ rows: [{ production_id: 'sale-999', migration_id: 'MIG-OLD' }] }),
      },
    ])
    const result = await findExistingProvenance(client, {
      entityType: 'sales',
      sourceFileChecksum: 'abc123', // same file content
      sourceSheet: 'January',
      sourceRowNumber: 482,
    })
    expect(result?.migrationId).toBe('MIG-OLD') // resolves to the original migration, not a fresh import
  })

  it('recordProvenance upserts on conflict without erroring on a duplicate key', async () => {
    const client = createMockClient([{ match: /INSERT INTO public\.migration_provenance/, respond: () => ({ rows: [] }) }])
    await expect(
      recordProvenance(client, {
        entityType: 'deliveries',
        sourceFileChecksum: 'chk1',
        sourceSheet: 'Sheet1',
        sourceRowNumber: 10,
        migrationId: 'MIG-1',
        productionId: 'delivery-1',
      })
    ).resolves.toBeUndefined()
    expect(client.calledMatching(/ON CONFLICT/).length).toBe(1)
  })

  it('clearProvenanceForMigration removes only rows for that migration (used on rollback)', async () => {
    const client = createMockClient([{ match: /DELETE FROM public\.migration_provenance/, respond: () => ({ rows: [] }) }])
    await clearProvenanceForMigration(client, 'MIG-1')
    const call = client.calledMatching(/DELETE FROM public\.migration_provenance/)[0]
    expect(call.params).toEqual(['MIG-1'])
  })
})
