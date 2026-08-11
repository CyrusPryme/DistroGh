import { describe, expect, it } from 'vitest'
import { buildMigrationTemplateWorkbook, buildAllMigrationTemplatesWorkbook, type MigrationTemplateRecord } from '@/lib/migration/template-xlsx'
import { parseWorkbook } from '@/lib/migration/parse'
import { detectEntityType } from '@/lib/migration/detect'

const vendorTemplate: MigrationTemplateRecord = {
  entity_type: 'vendors',
  label: 'Vendors',
  description: 'Supplier master data',
  required_columns: ['name', 'momo_number', 'momo_network'],
  optional_columns: ['contact_phone', 'contact_person_name', 'commission_rate'],
  sample_rows: [{
    name: 'Acme Foods',
    contact_phone: '0302123456',
    momo_number: '0244123456',
    momo_network: 'MTN',
    commission_rate: 10,
  }],
}

/**
 * Regression coverage for a real production incident: a user downloaded the official
 * "Vendors" migration template, filled in the "Data" sheet exactly as instructed, and
 * uploading it produced confusing sales-shaped errors ("qty must be > 0; product
 * identifier is required") that had nothing to do with their vendor data.
 *
 * Root cause (both now fixed):
 *  1. parseWorkbook() always read worksheets[0], which is the "Instructions" sheet added
 *     before "Data" by the template generator — so the parser read instructional prose,
 *     not the vendor rows.
 *  2. Required-column headers are rendered as "name *" in the template; without stripping
 *     that marker, "name *" never matches the "name" the rest of the engine expects.
 */
describe('Migration template round-trip — download template, fill in Data sheet, upload, parse', () => {
  it('parses the "Data" sheet (not "Instructions") and recovers clean column names without the required-marker asterisk', async () => {
    const buf = await buildMigrationTemplateWorkbook(vendorTemplate)
    const parsed = await parseWorkbook(buf)

    expect(parsed.sheetNames).toEqual(['Instructions', '_lists', 'Data'])
    expect(parsed.columns).toEqual([
      'name', 'momo_number', 'momo_network', 'contact_phone', 'contact_person_name', 'commission_rate',
    ])
    // The single pre-filled sample row must come through as real, usable vendor data —
    // never the instructional text from Sheet 1.
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      name: 'Acme Foods',
      momo_number: '0244123456',
      momo_network: 'MTN',
      commission_rate: 10,
    })
  })

  it('a filled-in vendor Data sheet is then correctly auto-detected as "vendors" (not "sales")', async () => {
    const buf = await buildMigrationTemplateWorkbook(vendorTemplate)
    const parsed = await parseWorkbook(buf)
    const entityType = detectEntityType('VENDOS APPROVED.xlsx', parsed.columns) // real-world misspelled filename
    expect(entityType).toBe('vendors')
  })

  it('the combined "download all templates" workbook still exposes clean, asterisk-free headers per entity sheet', async () => {
    const productsTemplate: MigrationTemplateRecord = {
      entity_type: 'products',
      label: 'Products',
      description: 'Vendor SKUs',
      required_columns: ['name', 'vendor_name', 'vendor_price'],
      optional_columns: ['barcode'],
      sample_rows: [{ name: 'Palm Oil 1L', vendor_name: 'Acme Foods', vendor_price: 25 }],
    }
    const buf = await buildAllMigrationTemplatesWorkbook([vendorTemplate, productsTemplate], {
      vendorNames: ['Acme Foods'],
    })
    const parsed = await parseWorkbook(buf)
    // selectDataSheet falls back to "last visible, non-reserved sheet" here since there is
    // no sheet literally named "Data" in the combined workbook — this exercises that path.
    expect(parsed.sheetNames[0]).toBe('Overview')
    expect(parsed.columns.every((c) => !c.includes('*'))).toBe(true)
  })
})
