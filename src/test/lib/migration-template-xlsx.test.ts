import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
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

const intakesTemplate: MigrationTemplateRecord = {
  entity_type: 'intakes',
  label: 'Receiving',
  description: 'Stock received at DistroGH',
  required_columns: ['vendor_name', 'product_name', 'quantity', 'received_date'],
  optional_columns: ['notes', 'barcode'],
  sample_rows: [{ vendor_name: 'Acme Foods', product_name: 'Palm Oil 1L', quantity: 100, received_date: '2024-01-15' }],
}

/**
 * Regression coverage for two real reports about date columns:
 *
 * 1. Every date typed into a date column was rejected with a "Date required" popup — including
 *    genuine past dates. Root cause: the validator checked `LEN(cell) >= 8`, but Excel
 *    auto-converts a recognised date into a numeric date serial, and LEN() on that number measures
 *    the serial's digit count (e.g. "45673" -> 5), not the displayed date string — so the check
 *    failed for every date, not just old ones.
 * 2. After switching to Excel's native `type: 'date'` validation, single-digit day/month entries
 *    like "3-12-2026" were still rejected while "12-10-2026" worked — Excel's own auto-recognition
 *    of typed dates is locale-dependent, and when it doesn't kick in the cell keeps raw text, which
 *    native `type: 'date'` validation always rejects (it never gets a number to compare). Fixed by
 *    switching to a custom formula with a DATEVALUE() fallback path that accepts text Excel didn't
 *    auto-convert, as long as it's still a parseable date — and by dropping the fragile "must not
 *    be after today" bound (a day/month swap can flip a near-term date across that line) in favour
 *    of a coarse, far-future sanity cap that a same-year transposition can never cross.
 */
describe('template-xlsx — date columns accept genuine past dates', () => {
  async function dateValidationOn(template: MigrationTemplateRecord, column: string) {
    const buf = await buildMigrationTemplateWorkbook(template)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const dataSheet = wb.getWorksheet('Data')!
    const colIndex = [...template.required_columns, ...template.optional_columns].indexOf(column) + 1
    return dataSheet.getCell(3, colIndex).dataValidation as ExcelJS.DataValidation
  }

  it('uses a custom formula (not a text-length check, not native date-only comparison) so a real date value is accepted', async () => {
    const validation = await dateValidationOn(intakesTemplate, 'received_date')
    expect(validation.type).toBe('custom')
  })

  it('accepts text Excel failed to auto-convert to a date, via a DATEVALUE() fallback path', async () => {
    const validation = await dateValidationOn(intakesTemplate, 'received_date')
    const formula = String((validation.formulae ?? [])[0])
    expect(formula).toContain('DATEVALUE')
    expect(formula).toContain('ISNUMBER')
    expect(formula).toContain('IFERROR')
  })

  it('does not use a "must not be after today" bound that a day/month swap could cross', async () => {
    const validation = await dateValidationOn(intakesTemplate, 'received_date')
    const formula = String((validation.formulae ?? [])[0])
    expect(formula).not.toContain('TODAY()')
    // Far-future sanity cap only — comfortably beyond any near-term day/month transposition.
    const maxYear = new Date().getUTCFullYear() + 10
    expect(formula).toContain(`DATE(${maxYear},12,31)`)
  })

  it('the accepted date range comfortably covers old historical dates, not just recent ones', async () => {
    const validation = await dateValidationOn(intakesTemplate, 'received_date')
    const formula = String((validation.formulae ?? [])[0])
    expect(formula).toContain('DATE(2000,1,1)')
  })

  it('date columns are pre-formatted as real dates (yyyy-mm-dd), not left as free text', async () => {
    const buf = await buildMigrationTemplateWorkbook(intakesTemplate)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const dataSheet = wb.getWorksheet('Data')!
    const colIndex = intakesTemplate.required_columns.indexOf('received_date') + 1
    expect(dataSheet.getCell(2, colIndex).numFmt).toBe('yyyy-mm-dd')
    // The pre-filled sample row itself is a real Date, not the raw "2024-01-15" string.
    expect(dataSheet.getCell(2, colIndex).value).toBeInstanceOf(Date)
  })
})

describe('template-xlsx — product dropdown (same pattern as the existing vendor dropdown)', () => {
  it('an intakes/deliveries/returns/sales product_name column gets a dropdown of existing products', async () => {
    const buf = await buildMigrationTemplateWorkbook(intakesTemplate, {
      vendorNames: ['Acme Foods'],
      productNames: ['Palm Oil 1L', 'Sugar 1kg'],
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const dataSheet = wb.getWorksheet('Data')!
    const colIndex = intakesTemplate.required_columns.indexOf('product_name') + 1
    const validation = dataSheet.getCell(3, colIndex).dataValidation as ExcelJS.DataValidation
    expect(validation.type).toBe('list')
    // The dropdown's source range points at the "_lists" sheet column registered for products —
    // read it out via the formula rather than assuming a fixed column, since registration order
    // depends on which columns precede it.
    const range = (validation.formulae ?? [])[0] as string
    const match = /\$([A-Z]+)\$1:\$[A-Z]+\$(\d+)/.exec(range)
    expect(match).not.toBeNull()
    const listsSheet = wb.getWorksheet('_lists')!
    const colLetter = match![1]
    const colNum = colLetter.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
    expect(listsSheet.getCell(1, colNum).value).toBe('Palm Oil 1L')
    expect(listsSheet.getCell(2, colNum).value).toBe('Sugar 1kg')
  })

  it('the Products template\'s own "name" column (defining a *new* product) is never itself turned into a product dropdown', async () => {
    const productsTemplate: MigrationTemplateRecord = {
      entity_type: 'products',
      label: 'Products',
      description: 'Vendor SKUs',
      required_columns: ['name', 'vendor_name', 'vendor_price'],
      optional_columns: ['barcode'],
      sample_rows: [{ name: 'Palm Oil 1L', vendor_name: 'Acme Foods', vendor_price: 25 }],
    }
    const buf = await buildMigrationTemplateWorkbook(productsTemplate, {
      vendorNames: ['Acme Foods'],
      productNames: ['Existing Product'],
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const dataSheet = wb.getWorksheet('Data')!
    const nameCol = productsTemplate.required_columns.indexOf('name') + 1
    const validation = dataSheet.getCell(3, nameCol).dataValidation as ExcelJS.DataValidation
    expect(validation?.type).not.toBe('list')
  })
})

const deliveriesTemplate: MigrationTemplateRecord = {
  entity_type: 'deliveries',
  label: 'Deliveries',
  description: 'Delivery runs + line items',
  required_columns: ['supermarket_name', 'product_name', 'quantity', 'delivery_date'],
  optional_columns: ['branch', 'store_code', 'transport_cost', 'barcode'],
  sample_rows: [{
    supermarket_name: 'Palace',
    branch: 'Accra Mall',
    product_name: 'Palm Oil 1L',
    quantity: 20,
    delivery_date: '2024-01-20',
    transport_cost: 50,
  }],
}

describe('template-xlsx — deliveries supermarket dropdowns', () => {
  it('supermarket_name and branch columns get live dropdown lists', async () => {
    const buf = await buildMigrationTemplateWorkbook(deliveriesTemplate, {
      vendorNames: ['Acme Foods'],
      productNames: ['Palm Oil 1L'],
      supermarketNames: ['Palace', 'Shoprite'],
      supermarketBranchLabels: ['Accra Mall', 'Palace — Osu'],
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const dataSheet = wb.getWorksheet('Data')!
    const columns = [...deliveriesTemplate.required_columns, ...deliveriesTemplate.optional_columns]

    const nameCol = columns.indexOf('supermarket_name') + 1
    const branchCol = columns.indexOf('branch') + 1
    const nameValidation = dataSheet.getCell(3, nameCol).dataValidation as ExcelJS.DataValidation
    const branchValidation = dataSheet.getCell(3, branchCol).dataValidation as ExcelJS.DataValidation

    expect(nameValidation.type).toBe('list')
    expect(branchValidation.type).toBe('list')

    const listsSheet = wb.getWorksheet('_lists')!
    const readListCol = (range: string) => {
      const match = /\$([A-Z]+)\$1:\$[A-Z]+\$(\d+)/.exec(range)
      expect(match).not.toBeNull()
      const colNum = match![1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
      const count = Number(match![2])
      return Array.from({ length: count }, (_, i) => listsSheet.getCell(i + 1, colNum).value)
    }

    expect(readListCol(String((nameValidation.formulae ?? [])[0]))).toEqual(['Palace', 'Shoprite'])
    expect(readListCol(String((branchValidation.formulae ?? [])[0]))).toEqual(['Accra Mall', 'Palace — Osu'])
  })
})
