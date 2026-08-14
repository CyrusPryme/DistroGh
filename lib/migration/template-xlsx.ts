import ExcelJS from 'exceljs'
import { ENTITY_LABELS } from '@/lib/migration/entities'
import type { MigrationEntityType } from '@/lib/migration/types'

export type MigrationTemplateRecord = {
  entity_type: string
  label: string
  description: string
  required_columns: string[]
  optional_columns: string[]
  sample_rows: Record<string, unknown>[]
}

/** Live data injected when generating templates (e.g. vendor/product dropdowns). */
export type TemplateBuildOptions = {
  vendorNames?: string[]
  productNames?: string[]
}

const VENDOR_NAME_COLUMNS = new Set(['vendor_name', 'vendor'])
// Deliberately excludes 'name' (the Products template's own new-product name field) and the
// free-text Palace-style sales identifiers (description/code/barcode) — those aren't a lookup
// against the existing catalogue, so forcing them into a dropdown would block legitimate values.
const PRODUCT_NAME_COLUMNS = new Set(['product_name', 'product'])
const PHONE_COLUMNS = new Set(['momo_number', 'contact_phone', 'phone'])
/** Earliest date accepted by date-column validation — generous enough to never reject genuine
 *  historical data, while still catching obvious typos (e.g. a stray 1900s date). */
const MIN_HISTORICAL_DATE = new Date(Date.UTC(2000, 0, 1))

const DATA_ROW_COUNT = 250
const HEADER_ROW = 1
const SAMPLE_ROW = 2
const FIRST_EDITABLE_ROW = 2
const LAST_DATA_ROW = DATA_ROW_COUNT + 1

type ListValidation = { kind: 'list'; options: string[] }
type DecimalValidation = { kind: 'decimal'; min?: number }
type WholeValidation = { kind: 'whole'; min?: number }
type DateValidation = { kind: 'date' }
type PhoneValidation = { kind: 'phone' }

type ColumnValidation = ListValidation | DecimalValidation | WholeValidation | DateValidation | PhoneValidation

/** Shared field validators (entity-specific overrides below). */
const FIELD_VALIDATIONS: Record<string, ColumnValidation> = {
  momo_network: { kind: 'list', options: ['MTN', 'Vodafone', 'AirtelTigo'] },
  status: { kind: 'list', options: ['active', 'pending_verification', 'suspended'] },
  reason: { kind: 'list', options: ['expired', 'defective_product', 'defective_packaging', 'other'] },
  quantity: { kind: 'whole', min: 1 },
  qty: { kind: 'whole', min: 1 },
  vendor_price: { kind: 'decimal', min: 0 },
  amount: { kind: 'decimal', min: 0 },
  amount_paid: { kind: 'decimal', min: 0 },
  amount_due: { kind: 'decimal', min: 0 },
  balance: { kind: 'decimal' },
  commission_rate: { kind: 'decimal', min: 0 },
  default_commission: { kind: 'decimal', min: 0 },
  transport_cost: { kind: 'decimal', min: 0 },
  markup_amount: { kind: 'decimal', min: 0 },
  supermarket_selling_price: { kind: 'decimal', min: 0 },
  years_paid: { kind: 'whole', min: 1 },
  momo_number: { kind: 'phone' },
  contact_phone: { kind: 'phone' },
  phone: { kind: 'phone' },
  received_date: { kind: 'date' },
  delivery_date: { kind: 'date' },
  return_date: { kind: 'date' },
  deduction_date: { kind: 'date' },
  payout_date: { kind: 'date' },
  as_of_date: { kind: 'date' },
  paid_at: { kind: 'date' },
  expires_at: { kind: 'date' },
  week_start: { kind: 'date' },
  week_end: { kind: 'date' },
  // report_month is a "YYYY-MM" month key, not a full date — real Excel date validation/picker
  // needs a day component, so it's left unvalidated here (documented in the Instructions sheet)
  // rather than forced through a validator built for full dates.
  fda_certificate_acquired_date: { kind: 'date' },
  fda_certificate_expiry_date: { kind: 'date' },
}

const ENTITY_FIELD_OVERRIDES: Partial<Record<string, Record<string, ColumnValidation>>> = {
  payouts: {
    status: { kind: 'list', options: ['completed', 'pending', 'failed'] },
  },
  returns: {
    reason: { kind: 'list', options: ['expired', 'defective_product', 'defective_packaging', 'other'] },
  },
}

function colLetter(index: number): string {
  let n = index
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function getValidation(
  entityType: string,
  column: string,
  options?: TemplateBuildOptions
): ColumnValidation | null {
  if (VENDOR_NAME_COLUMNS.has(column)) {
    const names = options?.vendorNames ?? []
    return {
      kind: 'list',
      options: names.length
        ? names
        : ['(No vendors in system — add vendors first)'],
    }
  }
  // The Products template's own 'name' column defines a *new* product — never turn that into a
  // dropdown of existing products, only the reference columns on other entities (intakes,
  // deliveries, returns, sales) that point at an existing catalogue item.
  if (entityType !== 'products' && PRODUCT_NAME_COLUMNS.has(column)) {
    const names = options?.productNames ?? []
    return {
      kind: 'list',
      options: names.length
        ? names
        : ['(No products in system — add products first)'],
    }
  }
  return ENTITY_FIELD_OVERRIDES[entityType]?.[column] ?? FIELD_VALIDATIONS[column] ?? null
}

function isPhoneColumn(column: string): boolean {
  return PHONE_COLUMNS.has(column)
}

function humanizeColumn(name: string): string {
  return name.replace(/_/g, ' ')
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31)
}

type ListRegistry = Map<string, string>

function registerList(
  listsSheet: ExcelJS.Worksheet,
  listCol: { value: number },
  registry: ListRegistry,
  key: string,
  options: string[]
): string {
  if (registry.has(key)) return registry.get(key)!
  const col = listCol.value++
  const letter = colLetter(col)
  options.forEach((opt, i) => {
    listsSheet.getCell(i + 1, col).value = opt
  })
  const range = `'_lists'!$${letter}$1:$${letter}$${options.length}`
  registry.set(key, range)
  return range
}

function buildCellValidation(
  validation: ColumnValidation,
  listRange: string | null,
  required: boolean,
  columnLetter: string
): ExcelJS.DataValidation | null {
  if (validation.kind === 'list' && listRange) {
    return {
      type: 'list',
      allowBlank: !required,
      formulae: [listRange],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Invalid value',
      error: 'Choose a value from the dropdown list.',
      showInputMessage: true,
      promptTitle: humanizeColumn(columnLetter),
      prompt: 'Select from the dropdown',
    }
  }

  if (validation.kind === 'decimal') {
    return {
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      allowBlank: !required,
      formulae: validation.min != null ? [validation.min] : [0],
      showErrorMessage: true,
      errorTitle: 'Invalid number',
      error: validation.min != null ? `Enter a number ≥ ${validation.min}` : 'Enter a valid decimal number',
    }
  }

  if (validation.kind === 'whole') {
    return {
      type: 'whole',
      operator: 'greaterThanOrEqual',
      allowBlank: !required,
      formulae: [validation.min ?? 1],
      showErrorMessage: true,
      errorTitle: 'Invalid quantity',
      error: `Enter a whole number ≥ ${validation.min ?? 1}`,
    }
  }

  if (validation.kind === 'phone') {
    return null
  }

  if (validation.kind === 'date') {
    // Native Excel date validation (not a textLength check on a typed-in string) — this is what
    // makes Excel offer its built-in date-picker calendar icon on the cell, and it validates the
    // *actual date value* Excel parsed, so any real past date is accepted. The previous
    // "text length >= 8" check broke as soon as Excel auto-converted a typed date into a real date
    // value: LEN() on a date serial number (e.g. 45673) is only 5 characters, so it failed for
    // every date — not just old ones — whenever Excel recognised the input as a date.
    return {
      type: 'date',
      operator: 'between',
      allowBlank: !required,
      formulae: [MIN_HISTORICAL_DATE, new Date()],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Invalid date',
      error: `Enter a valid past date (between ${MIN_HISTORICAL_DATE.toISOString().slice(0, 10)} and today).`,
      showInputMessage: true,
      promptTitle: 'Date',
      prompt: 'Click the cell for the date picker, or type YYYY-MM-DD. Any past date is fine.',
    }
  }

  return null
}

function applyPhoneColumnValidation(
  worksheet: ExcelJS.Worksheet,
  colIndex: number,
  required: boolean
) {
  const letter = colLetter(colIndex)
  for (let row = FIRST_EDITABLE_ROW; row <= LAST_DATA_ROW; row++) {
    const cell = worksheet.getCell(row, colIndex)
    cell.numFmt = '@'
    cell.dataValidation = {
      type: 'custom',
      allowBlank: !required,
      formulae: [`=AND(LEN(${letter}${row})=10,LEFT(${letter}${row},1)="0")`],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Invalid Ghana phone',
      error: 'Enter exactly 10 digits starting with 0 (e.g. 0243222222).',
      showInputMessage: true,
      promptTitle: 'Ghana phone / MoMo',
      prompt: '10 digits starting with 0 — e.g. 0243222222',
    }
  }
}

function applyColumnValidation(
  worksheet: ExcelJS.Worksheet,
  colIndex: number,
  validation: ColumnValidation,
  listRange: string | null,
  required: boolean
) {
  if (validation.kind === 'phone') {
    applyPhoneColumnValidation(worksheet, colIndex, required)
    return
  }

  const letter = colLetter(colIndex)
  const cellValidation = buildCellValidation(validation, listRange, required, letter)
  if (!cellValidation) return

  for (let row = FIRST_EDITABLE_ROW; row <= LAST_DATA_ROW; row++) {
    const cell = worksheet.getCell(row, colIndex)
    cell.dataValidation = cellValidation
    // Pre-format as a real date column so a value the user types gets stored as an actual date
    // (matching the 'date' validation type above) and displays unambiguously as YYYY-MM-DD
    // regardless of the user's Windows/Excel locale, instead of e.g. 1/15/2024.
    if (validation.kind === 'date') cell.numFmt = 'yyyy-mm-dd'
  }
}

function buildInstructionsSheet(
  workbook: ExcelJS.Workbook,
  template: MigrationTemplateRecord,
  options?: TemplateBuildOptions
) {
  const sheet = workbook.addWorksheet('Instructions')
  sheet.columns = [{ width: 90 }]
  const required = (template.required_columns || []).join(', ') || '—'
  const optional = (template.optional_columns || []).join(', ') || '—'

  const lines = [
    [`${template.label} — Migration Template`],
    [''],
    [template.description],
    [''],
    ['Required columns:', required],
    ['Optional columns:', optional],
    [''],
    ['How to use:'],
    ['1. Fill rows on the "Data" sheet (row 2 is an example — replace or add below).'],
    ['2. Use dropdowns where provided (momo_network, status, vendor_name, product_name, reason, etc.).'],
    ['3. Date columns accept any past date — click the cell for Excel\'s date picker, or type YYYY-MM-DD.'],
    ['4. Ghana phones: exactly 10 digits starting with 0 (e.g. 0243222222).'],
    ['5. Required columns are marked with * in the header.'],
    ['6. Save as .xlsx and upload in Data Management → Historical Migrations.'],
    ...(template.entity_type === 'products' || (template.required_columns || []).some((c) => VENDOR_NAME_COLUMNS.has(c))
      ? [[`Vendor dropdown lists ${options?.vendorNames?.length ?? 0} vendor(s) from the system at download time — re-download after adding/removing vendors.`]]
      : []),
    ...(template.entity_type !== 'products' && (template.required_columns || []).some((c) => PRODUCT_NAME_COLUMNS.has(c))
      ? [[`Product dropdown lists ${options?.productNames?.length ?? 0} product(s) from the system at download time — re-download after adding/removing products.`]]
      : []),
    [''],
    [`Entity type for upload: ${template.entity_type}`],
  ]

  lines.forEach((row, i) => {
    const r = sheet.getRow(i + 1)
    r.getCell(1).value = row[0]
    if (i === 0) r.font = { bold: true, size: 14 }
    if (row[0]?.startsWith('Required') || row[0]?.startsWith('Optional')) {
      r.font = { bold: true }
    }
  })
}

function populateTemplateSheets(
  workbook: ExcelJS.Workbook,
  template: MigrationTemplateRecord,
  dataSheetName = 'Data',
  shared?: { listsSheet: ExcelJS.Worksheet; listRegistry: ListRegistry; listCol: { value: number } },
  options?: TemplateBuildOptions
) {
  const requiredSet = new Set(template.required_columns || [])
  const columns = [
    ...(template.required_columns || []),
    ...(template.optional_columns || []),
  ]
  if (!columns.length) return

  let listsSheet = shared?.listsSheet
  let listRegistry = shared?.listRegistry
  if (!listsSheet) {
    listsSheet = workbook.addWorksheet('_lists')
    listsSheet.state = 'veryHidden'
    listRegistry = new Map()
  }
  if (!listRegistry) listRegistry = new Map()
  const listCol = shared?.listCol ?? { value: 1 }

  const dataSheet = workbook.addWorksheet(sanitizeSheetName(dataSheetName))

  dataSheet.columns = columns.map((key) => ({
    key,
    width: Math.min(28, Math.max(14, key.length + 4)),
  }))

  const headerRow = dataSheet.getRow(HEADER_ROW)
  columns.forEach((key, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = requiredSet.has(key) ? `${key} *` : key
    cell.font = { bold: true, color: { argb: requiredSet.has(key) ? 'FF9A3412' : 'FF1E293B' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: requiredSet.has(key) ? 'FFFFEDD5' : 'FFF1F5F9' },
    }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })

  const sample = template.sample_rows?.[0] ?? {}
  const sampleRow = dataSheet.getRow(SAMPLE_ROW)
  columns.forEach((key, idx) => {
    const val = sample[key]
    const cell = sampleRow.getCell(idx + 1)
    if (val !== undefined && val !== null) {
      if (isPhoneColumn(key)) {
        cell.value = String(val)
        cell.numFmt = '@'
      } else if (VENDOR_NAME_COLUMNS.has(key) && options?.vendorNames?.length) {
        cell.value = options.vendorNames.includes(String(val))
          ? String(val)
          : options.vendorNames[0]
      } else if (template.entity_type !== 'products' && PRODUCT_NAME_COLUMNS.has(key) && options?.productNames?.length) {
        cell.value = options.productNames.includes(String(val))
          ? String(val)
          : options.productNames[0]
      } else if (FIELD_VALIDATIONS[key]?.kind === 'date') {
        // Store as a real date (not the raw "2024-01-15" string) so it renders through the
        // yyyy-mm-dd numFmt applied below exactly like a value the user would enter themselves.
        const parsed = new Date(String(val))
        cell.value = Number.isNaN(parsed.getTime()) ? (val as string | number) : parsed
        cell.numFmt = 'yyyy-mm-dd'
      } else {
        cell.value = val as string | number
      }
    }
  })
  sampleRow.font = { italic: true, color: { argb: 'FF64748B' } }

  columns.forEach((key, idx) => {
    const colIndex = idx + 1
    const validation = getValidation(template.entity_type, key, options)
    if (!validation) return
    let listRange: string | null = null
    if (validation.kind === 'list') {
      const listKey = VENDOR_NAME_COLUMNS.has(key)
        ? 'live:vendors'
        : PRODUCT_NAME_COLUMNS.has(key)
          ? 'live:products'
          : `${template.entity_type}:${key}`
      listRange = registerList(
        listsSheet,
        listCol,
        listRegistry,
        listKey,
        validation.options
      )
    }
    applyColumnValidation(dataSheet, colIndex, validation, listRange, requiredSet.has(key))
  })

  dataSheet.views = [{ state: 'frozen', ySplit: 1 }]
  return dataSheet
}

/** Build a single-entity migration template workbook. */
export async function buildMigrationTemplateWorkbook(
  template: MigrationTemplateRecord,
  options?: TemplateBuildOptions
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DistroGH Data Management'
  workbook.created = new Date()

  buildInstructionsSheet(workbook, template, options)
  populateTemplateSheets(workbook, template, 'Data', undefined, options)

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/** All entity templates in one workbook (one sheet per entity). */
export async function buildAllMigrationTemplatesWorkbook(
  templates: MigrationTemplateRecord[],
  options?: TemplateBuildOptions
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DistroGH Data Management'
  workbook.created = new Date()

  const overview = workbook.addWorksheet('Overview')
  overview.columns = [{ width: 24 }, { width: 60 }, { width: 40 }]
  overview.getRow(1).values = ['Entity', 'Description', 'Required columns']
  overview.getRow(1).font = { bold: true }
  templates.forEach((t, i) => {
    overview.getRow(i + 2).values = [
      ENTITY_LABELS[t.entity_type as MigrationEntityType] || t.label,
      t.description,
      (t.required_columns || []).join(', '),
    ]
  })

  const listsSheet = workbook.addWorksheet('_lists')
  listsSheet.state = 'veryHidden'
  const shared = { listsSheet, listRegistry: new Map<string, string>(), listCol: { value: 1 } }

  for (const template of templates) {
    populateTemplateSheets(
      workbook,
      template,
      sanitizeSheetName(ENTITY_LABELS[template.entity_type as MigrationEntityType] || template.label),
      shared,
      options
    )
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export function templateDownloadFilename(entityType: string): string {
  return `migration-${entityType.replace(/[^a-z0-9_-]/gi, '-')}-template.xlsx`
}
