import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  buildMigrationTemplateWorkbook,
  getMigrationTemplateColumnOrder,
  resolveTemplateColumnValidation,
  type MigrationTemplateRecord,
} from '@/lib/migration/template-xlsx'
import {
  CANONICAL_MIGRATION_TEMPLATE_SPECS,
  expectedDropdownExpectation,
  type DropdownExpectation,
} from '@/lib/migration/template-specs'

const LIVE_OPTIONS = {
  vendorNames: ['Vendor A'],
  productNames: ['Product A'],
  productBarcodes: ['1234567890'],
  supermarketNames: ['Palace'],
  supermarketBranchLabels: ['Accra Mall'],
  categoryNames: ['Beverages'],
}

function specToTemplate(spec: (typeof CANONICAL_MIGRATION_TEMPLATE_SPECS)[number]): MigrationTemplateRecord {
  return {
    entity_type: spec.entity_type,
    label: spec.entity_type,
    description: `${spec.entity_type} template`,
    required_columns: spec.required_columns,
    optional_columns: spec.optional_columns,
    sample_rows: [{}],
  }
}

function expectationToValidationKind(exp: DropdownExpectation): string | null {
  if (
    exp === 'live_vendor' ||
    exp === 'live_product' ||
    exp === 'live_supermarket_chain' ||
    exp === 'live_supermarket_branch' ||
    exp === 'live_category' ||
    exp === 'live_barcode' ||
    exp === 'static_list'
  ) {
    return 'list'
  }
  if (exp === 'date') return 'date'
  if (exp === 'phone') return 'phone'
  if (exp === 'decimal') return 'decimal'
  if (exp === 'whole') return 'whole'
  return null
}

describe('migration template column coverage', () => {
  it('every canonical template column matches resolveTemplateColumnValidation expectations', () => {
    const mismatches: string[] = []
    for (const spec of CANONICAL_MIGRATION_TEMPLATE_SPECS) {
      const columns = [...spec.required_columns, ...spec.optional_columns]
      for (const column of columns) {
        const expected = expectedDropdownExpectation(spec.entity_type, column)
        const validation = resolveTemplateColumnValidation(spec.entity_type, column, LIVE_OPTIONS)
        const expectedKind = expectationToValidationKind(expected)
        const actualKind = validation?.kind ?? null
        if (expectedKind !== actualKind) {
          mismatches.push(
            `${spec.entity_type}.${column}: expected ${expected} (${expectedKind}), got ${actualKind ?? 'none'}`
          )
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('live reference columns use non-empty live lists when data exists', () => {
    for (const spec of CANONICAL_MIGRATION_TEMPLATE_SPECS) {
      for (const column of [...spec.required_columns, ...spec.optional_columns]) {
        const expected = expectedDropdownExpectation(spec.entity_type, column)
        if (!expected.startsWith('live_')) continue
        const validation = resolveTemplateColumnValidation(spec.entity_type, column, LIVE_OPTIONS)
        expect(validation?.kind, `${spec.entity_type}.${column}`).toBe('list')
        if (validation?.kind === 'list') {
          expect(validation.options.length).toBeGreaterThan(0)
          expect(validation.options[0]).not.toMatch(/^\(No /)
        }
      }
    }
  })

  it('supermarkets master template never adds branch/name outlet dropdowns', async () => {
    const spec = CANONICAL_MIGRATION_TEMPLATE_SPECS.find((s) => s.entity_type === 'supermarkets')!
    const buf = await buildMigrationTemplateWorkbook(specToTemplate(spec), LIVE_OPTIONS)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const sheet = wb.getWorksheet('Data')!
    const columns = [...spec.required_columns, ...spec.optional_columns]
    const branchCol = columns.indexOf('branch') + 1
    const nameCol = columns.indexOf('name') + 1
    expect(sheet.getCell(3, branchCol).dataValidation?.type).not.toBe('list')
    expect(sheet.getCell(3, nameCol).dataValidation?.type).not.toBe('list')
  })

  it('returns template gets supermarket_name and branch dropdowns', async () => {
    const spec = CANONICAL_MIGRATION_TEMPLATE_SPECS.find((s) => s.entity_type === 'returns')!
    const buf = await buildMigrationTemplateWorkbook(specToTemplate(spec), LIVE_OPTIONS)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const sheet = wb.getWorksheet('Data')!
    const columns = [...spec.required_columns, ...spec.optional_columns]
    expect(sheet.getCell(3, columns.indexOf('supermarket_name') + 1).dataValidation?.type).toBe('list')
    expect(sheet.getCell(3, columns.indexOf('branch') + 1).dataValidation?.type).toBe('list')
  })

  it('sales template store_name gets branch dropdown; description stays free text', async () => {
    const spec = CANONICAL_MIGRATION_TEMPLATE_SPECS.find((s) => s.entity_type === 'sales')!
    const template = specToTemplate(spec)
    const buf = await buildMigrationTemplateWorkbook(template, LIVE_OPTIONS)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const sheet = wb.getWorksheet('Data')!
    const columns = getMigrationTemplateColumnOrder(template)

    const listCols = [
      'store_name',
      'branch',
      'product_name',
      'barcode',
      'paid',
      'supermarket_paid',
      'month',
    ] as const
    for (const col of listCols) {
      expect(sheet.getCell(3, columns.indexOf(col) + 1).dataValidation?.type, col).toBe('list')
    }

    expect(sheet.getCell(3, columns.indexOf('description') + 1).dataValidation?.type).not.toBe('list')
    expect(sheet.getCell(3, columns.indexOf('code') + 1).dataValidation?.type).not.toBe('list')
    expect(sheet.getCell(3, columns.indexOf('report_month') + 1).dataValidation?.type).toBe('custom')
    expect(sheet.getCell(3, columns.indexOf('report_year') + 1).dataValidation?.type).toBe('whole')
    expect(columns).not.toContain('unit_price')
    expect(columns).not.toContain('vendor')
  })

  it('deliveries template includes destination_type static dropdown', async () => {
    const spec = CANONICAL_MIGRATION_TEMPLATE_SPECS.find((s) => s.entity_type === 'deliveries')!
    const buf = await buildMigrationTemplateWorkbook(specToTemplate(spec), LIVE_OPTIONS)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const sheet = wb.getWorksheet('Data')!
    const columns = [...spec.required_columns, ...spec.optional_columns]
    const validation = sheet.getCell(3, columns.indexOf('destination_type') + 1).dataValidation
    expect(validation?.type).toBe('list')
  })

  it('products template category column gets live category dropdown', async () => {
    const spec = CANONICAL_MIGRATION_TEMPLATE_SPECS.find((s) => s.entity_type === 'products')!
    const buf = await buildMigrationTemplateWorkbook(specToTemplate(spec), LIVE_OPTIONS)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const sheet = wb.getWorksheet('Data')!
    const columns = [...spec.required_columns, ...spec.optional_columns]
    expect(sheet.getCell(3, columns.indexOf('category') + 1).dataValidation?.type).toBe('list')
    expect(sheet.getCell(3, columns.indexOf('name') + 1).dataValidation?.type).not.toBe('list')
  })
})
