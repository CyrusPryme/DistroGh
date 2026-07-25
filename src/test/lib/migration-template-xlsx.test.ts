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

  it('generates combined templates workbook', async () => {
    const buf = await buildAllMigrationTemplatesWorkbook([vendorTemplate])
    expect(buf.length).toBeGreaterThan(1000)
  })
})
