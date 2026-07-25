import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import {
  buildAllMigrationTemplatesWorkbook,
  type MigrationTemplateRecord,
} from '@/lib/migration/template-xlsx'

function mapTemplate(row: Record<string, unknown>): MigrationTemplateRecord {
  return {
    entity_type: String(row.entity_type),
    label: String(row.label),
    description: String(row.description ?? ''),
    required_columns: (row.required_columns as string[]) ?? [],
    optional_columns: (row.optional_columns as string[]) ?? [],
    sample_rows: (row.sample_rows as Record<string, unknown>[]) ?? [],
  }
}

export async function GET() {
  try {
    await requirePermission('historical_migrations', 'read')
    const { rows } = await getDbPool().query(
      `SELECT * FROM public.migration_templates ORDER BY label ASC`
    )
    const templates = rows.map(mapTemplate)
    const buffer = await buildAllMigrationTemplatesWorkbook(templates)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="migration-all-templates.xlsx"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to generate templates workbook')
  }
}
