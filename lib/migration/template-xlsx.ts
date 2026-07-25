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
  report_month: { kind: 'date' },
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

function getValidation(entityType: string, column: string): ColumnValidation | null {
  return ENTITY_FIELD_OVERRIDES[entityType]?.[column] ?? FIELD_VALIDATIONS[column] ?? null
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
    return {
      type: 'textLength',
      operator: 'greaterThanOrEqual',
      allowBlank: !required,
      formulae: [10],
      showErrorMessage: true,
      errorTitle: 'Invalid phone',
      error: 'Phone / MoMo numbers should be at least 10 digits',
      showInputMessage: true,
      prompt: 'e.g. 0244123456',
    }
  }

  if (validation.kind === 'date') {
    return {
      type: 'textLength',
      operator: 'greaterThanOrEqual',
      allowBlank: !required,
      formulae: [8],
      showErrorMessage: true,
      errorTitle: 'Date required',
      error: 'Enter a date as YYYY-MM-DD (e.g. 2024-01-15)',
      showInputMessage: true,
      promptTitle: 'Date format',
      prompt: 'YYYY-MM-DD (e.g. 2024-01-15)',
    }
  }

  return null
}

function applyColumnValidation(
  worksheet: ExcelJS.Worksheet,
  colIndex: number,
  validation: ColumnValidation,
  listRange: string | null,
  required: boolean
) {
  const letter = colLetter(colIndex)
  const cellValidation = buildCellValidation(validation, listRange, required, letter)
  if (!cellValidation) return

  for (let row = FIRST_EDITABLE_ROW; row <= LAST_DATA_ROW; row++) {
    worksheet.getCell(row, colIndex).dataValidation = cellValidation
  }
}

function buildInstructionsSheet(
  workbook: ExcelJS.Workbook,
  template: MigrationTemplateRecord
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
    ['2. Use dropdowns where provided (momo_network, status, reason, etc.).'],
    ['3. Dates must be YYYY-MM-DD. Phone/MoMo numbers: at least 10 digits.'],
    ['4. Required columns are marked with * in the header.'],
    ['5. Save as .xlsx and upload in Data Management → Historical Migrations.'],
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
  shared?: { listsSheet: ExcelJS.Worksheet; listRegistry: ListRegistry; listCol: { value: number } }
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
    if (val !== undefined && val !== null) sampleRow.getCell(idx + 1).value = val as string | number
  })
  sampleRow.font = { italic: true, color: { argb: 'FF64748B' } }

  columns.forEach((key, idx) => {
    const colIndex = idx + 1
    const validation = getValidation(template.entity_type, key)
    if (!validation) return
    let listRange: string | null = null
    if (validation.kind === 'list') {
      listRange = registerList(
        listsSheet,
        listCol,
        listRegistry,
        `${template.entity_type}:${key}`,
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
  template: MigrationTemplateRecord
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DistroGH Data Management'
  workbook.created = new Date()

  buildInstructionsSheet(workbook, template)
  populateTemplateSheets(workbook, template, 'Data')

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/** All entity templates in one workbook (one sheet per entity). */
export async function buildAllMigrationTemplatesWorkbook(
  templates: MigrationTemplateRecord[]
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
      shared
    )
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export function templateDownloadFilename(entityType: string): string {
  return `migration-${entityType.replace(/[^a-z0-9_-]/gi, '-')}-template.xlsx`
}
