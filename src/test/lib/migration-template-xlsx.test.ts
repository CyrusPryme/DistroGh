import { describe, expect, it } from 'vitest'
import {
  buildMigrationTemplateWorkbook,
  buildAllMigrationTemplatesWorkbook,
  type MigrationTemplateRecord,
} from '@/lib/migration/template-xlsx'

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

describe('template-xlsx', () => {
  it('generates a non-empty vendor template buffer', async () => {
    const buf = await buildMigrationTemplateWorkbook(vendorTemplate)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 2).toString()).toBe('PK')
  })

  it('generates products template with vendor dropdown list', async () => {
    const productsTemplate: MigrationTemplateRecord = {
      entity_type: 'products',
      label: 'Products',
      description: 'Vendor SKUs',
      required_columns: ['name', 'vendor_name', 'vendor_price'],
      optional_columns: ['barcode'],
      sample_rows: [{ name: 'Palm Oil 1L', vendor_name: 'Acme Foods', vendor_price: 25 }],
    }
    const buf = await buildMigrationTemplateWorkbook(productsTemplate, {
      vendorNames: ['Acme Foods', 'Beta Traders'],
    })
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('generates combined templates workbook', async () => {
    const buf = await buildAllMigrationTemplatesWorkbook([vendorTemplate], {
      vendorNames: ['Acme Foods'],
    })
    expect(buf.length).toBeGreaterThan(1000)
  })
})
