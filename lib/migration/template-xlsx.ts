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
  /** Distinct supermarket chain names (deliveries/returns supermarket_name column). */
  supermarketNames?: string[]
  /** Branch/outlet labels (sales store_name, deliveries branch, etc.). */
  supermarketBranchLabels?: string[]
  /** Product category names (products template). */
  categoryNames?: string[]
  /** Product barcodes (sales/intakes optional barcode column). */
  productBarcodes?: string[]
}

const VENDOR_NAME_COLUMNS = new Set(['vendor_name', 'vendor'])
const SUPERMARKET_NAME_COLUMNS = new Set(['supermarket_name'])
const SUPERMARKET_BRANCH_COLUMNS = new Set(['store_name', 'branch'])
const CATEGORY_COLUMNS = new Set(['category'])
/** Master-data templates define NEW outlets — never constrain name/branch to existing records. */
const SUPERMARKET_DROPDOWN_ENTITY_EXCLUSIONS = new Set(['supermarkets', 'supermarket_chains'])
// Deliberately excludes 'name' (the Products template's own new-product name field) and the
// free-text Palace-style sales identifiers (description/code/barcode) — those aren't a lookup
// against the existing catalogue, so forcing them into a dropdown would block legitimate values.
const PRODUCT_NAME_COLUMNS = new Set(['product_name', 'product'])
const PRODUCT_BARCODE_COLUMNS = new Set(['barcode'])
const PHONE_COLUMNS = new Set(['momo_number', 'contact_phone', 'phone'])

const MONTH_NAME_OPTIONS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
]

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
  TCostEx: { kind: 'decimal', min: 0 },
  tcostex: { kind: 'decimal', min: 0 },
  unit_price: { kind: 'decimal', min: 0 },
  markup_amount: { kind: 'decimal', min: 0 },
  supermarket_selling_price: { kind: 'decimal', min: 0 },
  years_paid: { kind: 'whole', min: 1 },
  report_year: { kind: 'whole', min: 2000 },
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
  deliveries: {
    destination_type: {
      kind: 'list',
      options: ['WAREHOUSE', 'DISTRIBUTION_POINT', 'UNKNOWN_HISTORICAL'],
    },
  },
  payouts: {
    status: { kind: 'list', options: ['completed', 'pending', 'failed'] },
  },
  returns: {
    reason: { kind: 'list', options: ['expired', 'defective_product', 'defective_packaging', 'other'] },
  },
  sales: {
    paid: { kind: 'list', options: ['Yes'] },
    supermarket_paid: { kind: 'list', options: ['Yes', 'No'] },
    report_month: { kind: 'date' },
    month: { kind: 'list', options: MONTH_NAME_OPTIONS },
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

function allowsSupermarketReferenceDropdown(entityType: string, column: string): boolean {
  if (SUPERMARKET_DROPDOWN_ENTITY_EXCLUSIONS.has(entityType)) return false
  return SUPERMARKET_NAME_COLUMNS.has(column) || SUPERMARKET_BRANCH_COLUMNS.has(column)
}

/** Exported for template coverage tests — resolves Excel validation for one template column. */
export function resolveTemplateColumnValidation(
  entityType: string,
  column: string,
  options?: TemplateBuildOptions
): ColumnValidation | null {
  return getValidation(entityType, column, options)
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
  if (SUPERMARKET_NAME_COLUMNS.has(column) && allowsSupermarketReferenceDropdown(entityType, column)) {
    const names = options?.supermarketNames ?? []
    return {
      kind: 'list',
      options: names.length
        ? names
        : ['(No supermarkets in system — add supermarkets first)'],
    }
  }
  if (SUPERMARKET_BRANCH_COLUMNS.has(column) && allowsSupermarketReferenceDropdown(entityType, column)) {
    const branches = options?.supermarketBranchLabels ?? []
    return {
      kind: 'list',
      options: branches.length
        ? branches
        : ['(No supermarkets in system — add supermarkets first)'],
    }
  }
  if (entityType === 'products' && CATEGORY_COLUMNS.has(column)) {
    const names = options?.categoryNames ?? []
    return {
      kind: 'list',
      options: names.length ? names : ['(No categories in system — add categories first)'],
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
  if (entityType !== 'products' && PRODUCT_BARCODE_COLUMNS.has(column)) {
    const barcodes = options?.productBarcodes ?? []
    return {
      kind: 'list',
      options: barcodes.length
        ? barcodes
        : ['(No product barcodes in system — add barcodes on products first)'],
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

  if (validation.kind === 'phone' || validation.kind === 'date') {
    // Both need a per-row formula referencing that row's own cell (LEN(B7), DATEVALUE(B7), ...),
    // so they're built directly in applyColumnValidation's per-row loop instead of here.
    return null
  }

  return null
}

/** Latest year date-column validation accepts — generous enough that no genuine historical entry
 *  is ever near the boundary (a day/month transposition can't jump a date by *years*), while still
 *  catching a wildly wrong year typo (e.g. 2099 instead of 2026). Computed at generation time so
 *  the bound never goes stale for templates downloaded long after this code was written. */
function maxHistoricalYear(): number {
  return new Date().getUTCFullYear() + 10
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

function applyDateColumnValidation(
  worksheet: ExcelJS.Worksheet,
  colIndex: number,
  required: boolean
) {
  const letter = colLetter(colIndex)
  const minYear = 2000
  const maxYear = maxHistoricalYear()
  for (let row = FIRST_EDITABLE_ROW; row <= LAST_DATA_ROW; row++) {
    const ref = `${letter}${row}`
    const cell = worksheet.getCell(row, colIndex)
    // Pre-format as a real date so a value the user types gets stored as an actual date and
    // displays unambiguously as YYYY-MM-DD regardless of the user's Windows/Excel locale.
    cell.numFmt = 'yyyy-mm-dd'
    cell.dataValidation = {
      type: 'custom',
      allowBlank: !required,
      // Excel's own "did the user type a date" auto-recognition is locale-dependent and can be
      // inconsistent for single-digit day/month values (e.g. "3-12-2026" fails to auto-convert to
      // a real date on some regional settings while "12-10-2026" succeeds) — when auto-conversion
      // doesn't happen, the cell keeps the raw text, and Excel's native `type: 'date'` validation
      // rejects it outright because it never even gets a number to compare. This custom formula
      // accepts either: (a) a value Excel already turned into a real date, or (b) text that
      // DATEVALUE() can still interpret as a date — a second, independent parse path that covers
      // exactly the case where (a) fails. IFERROR guards DATEVALUE() for non-date text/blanks.
      formulae: [
        `=OR(AND(ISNUMBER(${ref}),${ref}>=DATE(${minYear},1,1),${ref}<=DATE(${maxYear},12,31)),AND(IFERROR(DATEVALUE(${ref}),0)>=DATE(${minYear},1,1),IFERROR(DATEVALUE(${ref}),0)<=DATE(${maxYear},12,31)))`,
      ],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Invalid date',
      error: `Enter a valid date between ${minYear} and ${maxYear} (e.g. 2024-01-15). Any past date is fine.`,
      showInputMessage: true,
      promptTitle: 'Date',
      prompt: 'Click the cell for the date picker, or type a date (e.g. 2024-01-15). Any past date is fine.',
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

  if (validation.kind === 'date') {
    applyDateColumnValidation(worksheet, colIndex, required)
    return
  }

  const letter = colLetter(colIndex)
  const cellValidation = buildCellValidation(validation, listRange, required, letter)
  if (!cellValidation) return

  for (let row = FIRST_EDITABLE_ROW; row <= LAST_DATA_ROW; row++) {
    worksheet.getCell(row, colIndex).dataValidation = cellValidation
  }
}

/** Excel column order (required columns first, then optional). */
export function getMigrationTemplateColumnOrder(template: MigrationTemplateRecord): string[] {
  return [...(template.required_columns || []), ...(template.optional_columns || [])]
}

function templateColumns(template: MigrationTemplateRecord): string[] {
  return getMigrationTemplateColumnOrder(template)
}

function templateHasColumn(template: MigrationTemplateRecord, columns: Set<string>): boolean {
  return templateColumns(template).some((c) => columns.has(c))
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
    ...(templateHasColumn(template, VENDOR_NAME_COLUMNS)
      ? [[`Vendor dropdown lists ${options?.vendorNames?.length ?? 0} vendor(s) from the system at download time — re-download after changes.`]]
      : []),
    ...(templateHasColumn(template, PRODUCT_NAME_COLUMNS)
      ? [[`Product dropdown lists ${options?.productNames?.length ?? 0} product(s) from the system at download time — re-download after changes.`]]
      : []),
    ...(templateHasColumn(template, PRODUCT_BARCODE_COLUMNS)
      ? [[`Barcode dropdown lists ${options?.productBarcodes?.length ?? 0} barcode(s) at download time.`]]
      : []),
    ...(template.entity_type === 'products' && templateHasColumn(template, CATEGORY_COLUMNS)
      ? [[`Category dropdown lists ${options?.categoryNames?.length ?? 0} categor(ies) at download time.`]]
      : []),
    ...(templateHasColumn(template, SUPERMARKET_NAME_COLUMNS)
      ? [[`Supermarket name dropdown lists ${options?.supermarketNames?.length ?? 0} chain(s) at download time.`]]
      : []),
    ...(templateHasColumn(template, SUPERMARKET_BRANCH_COLUMNS)
      ? [[`Branch / store_name dropdown lists ${options?.supermarketBranchLabels?.length ?? 0} outlet label(s) at download time.`]]
      : []),
    ...(template.entity_type === 'sales'
      ? [
          ['For Palace exports: upload the supermarket file as-is, or use this template for manual historical rows.'],
          ['Aggregated upload: one row per sale line — set report_month (or month + report_year) on every row.'],
          ['description + code (free text) match products by name/barcode — vendor comes from the matched product, not a column here.'],
          ['qty + TCostEx only: per-unit price at recording = TCostEx ÷ qty (computed on import — do not add unit_price).'],
          ['Each row keeps its own TCostEx — past price changes stay on the sale; live product catalog prices are never overwritten.'],
          ['store_name / branch = supermarket outlet (dropdown). TCostEx = vendor line total (PAYMENT TO SUPPLIER) as recorded.'],
          ['report_month: first day of sales month (e.g. 2024-06-01). Legacy MONTH-only rows: use month + report_year columns.'],
          ['paid / supermarket_paid: Yes = supermarket settled with DistroGH; blank or No = awaiting payment (excluded from vendor balance).'],
        ]
      : []),
    ...(template.entity_type === 'deliveries'
      ? [
          ['destination_type: use WAREHOUSE / DISTRIBUTION_POINT / UNKNOWN_HISTORICAL when stock did not go to a registered outlet branch.'],
          ['destination_reference: free-text warehouse or distribution point name when destination_type is not BRANCH.'],
        ]
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
  const columns = templateColumns(template)
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
      } else if (
        allowsSupermarketReferenceDropdown(template.entity_type, key) &&
        SUPERMARKET_NAME_COLUMNS.has(key) &&
        options?.supermarketNames?.length
      ) {
        cell.value = options.supermarketNames.includes(String(val))
          ? String(val)
          : options.supermarketNames[0]
      } else if (
        allowsSupermarketReferenceDropdown(template.entity_type, key) &&
        SUPERMARKET_BRANCH_COLUMNS.has(key) &&
        options?.supermarketBranchLabels?.length
      ) {
        cell.value = options.supermarketBranchLabels.includes(String(val))
          ? String(val)
          : options.supermarketBranchLabels[0]
      } else if (template.entity_type === 'products' && CATEGORY_COLUMNS.has(key) && options?.categoryNames?.length) {
        cell.value = options.categoryNames.includes(String(val)) ? String(val) : options.categoryNames[0]
      } else if (template.entity_type !== 'products' && PRODUCT_NAME_COLUMNS.has(key) && options?.productNames?.length) {
        cell.value = options.productNames.includes(String(val))
          ? String(val)
          : options.productNames[0]
      } else if (
        template.entity_type !== 'products' &&
        PRODUCT_BARCODE_COLUMNS.has(key) &&
        options?.productBarcodes?.length
      ) {
        cell.value = options.productBarcodes.includes(String(val))
          ? String(val)
          : options.productBarcodes[0]
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
        : allowsSupermarketReferenceDropdown(template.entity_type, key) && SUPERMARKET_NAME_COLUMNS.has(key)
          ? 'live:supermarket_names'
          : allowsSupermarketReferenceDropdown(template.entity_type, key) && SUPERMARKET_BRANCH_COLUMNS.has(key)
            ? 'live:supermarket_branches'
            : template.entity_type === 'products' && CATEGORY_COLUMNS.has(key)
              ? 'live:categories'
              : PRODUCT_BARCODE_COLUMNS.has(key)
                ? 'live:product_barcodes'
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
