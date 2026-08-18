import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import {
  buildMigrationTemplateWorkbook,
  templateDownloadFilename,
  type MigrationTemplateRecord,
} from '@/lib/migration/template-xlsx'
import { fetchActiveVendorNames } from '@/lib/migration/template-vendors'
import { fetchActiveProductNames } from '@/lib/migration/template-products'
import { fetchSupermarketBranchLabels } from '@/lib/migration/template-supermarkets'

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ entity: string }> }
) {
  try {
    await requirePermission('historical_migrations', 'read')
    const { entity } = await ctx.params
    const { rows } = await getDbPool().query(
      `SELECT * FROM public.migration_templates WHERE entity_type = $1`,
      [entity]
    )
    if (!rows[0]) {
      return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })
    }

    const template = mapTemplate(rows[0])
    const pool = getDbPool()
    const [vendorNames, productNames, supermarketBranchLabels] = await Promise.all([
      fetchActiveVendorNames(pool),
      fetchActiveProductNames(pool),
      template.entity_type === 'sales' ? fetchSupermarketBranchLabels(pool) : Promise.resolve([]),
    ])
    const buffer = await buildMigrationTemplateWorkbook(template, {
      vendorNames,
      productNames,
      supermarketBranchLabels,
    })
    const filename = templateDownloadFilename(template.entity_type)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to generate template')
  }
}
