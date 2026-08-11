import type { PoolClient, Pool } from 'pg'

export interface ProvenanceKey {
  entityType: string
  sourceFileChecksum: string
  sourceSheet: string | null
  sourceRowNumber: number
}

/**
 * Idempotency guard: "Migration MIG-2026-001, File Sales_January.xlsx, Sheet January,
 * Row 482 has already been migrated — do not import it again." Keyed on file content
 * checksum (not migration_id) so re-uploading the same spreadsheet into a *new* migration
 * project still refuses to duplicate production records.
 */
export async function findExistingProvenance(
  db: Pool | PoolClient,
  key: ProvenanceKey
): Promise<{ productionId: string | null; migrationId: string } | null> {
  const { rows } = await db.query(
    `SELECT production_id, migration_id FROM public.migration_provenance
     WHERE entity_type = $1 AND source_file_checksum = $2
       AND source_sheet = $3 AND source_row_number = $4
     LIMIT 1`,
    [key.entityType, key.sourceFileChecksum, key.sourceSheet ?? '', key.sourceRowNumber]
  )
  if (!rows[0]) return null
  return { productionId: rows[0].production_id ?? null, migrationId: rows[0].migration_id }
}

export async function recordProvenance(
  db: Pool | PoolClient,
  params: ProvenanceKey & { migrationId: string; productionId: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO public.migration_provenance
      (entity_type, production_id, migration_id, source_file_checksum, source_sheet, source_row_number)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (entity_type, source_file_checksum, source_sheet, source_row_number)
     DO UPDATE SET production_id = COALESCE(EXCLUDED.production_id, public.migration_provenance.production_id)`,
    [
      params.entityType,
      params.productionId,
      params.migrationId,
      params.sourceFileChecksum,
      params.sourceSheet ?? '',
      params.sourceRowNumber,
    ]
  )
}

export async function clearProvenanceForMigration(db: Pool | PoolClient, migrationId: string): Promise<void> {
  await db.query(`DELETE FROM public.migration_provenance WHERE migration_id = $1`, [migrationId])
}
