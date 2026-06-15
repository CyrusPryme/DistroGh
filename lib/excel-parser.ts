import ExcelJS from 'exceljs'
import { ParsedSaleRow, ImportPreview } from '@/types'
import { roundMoney } from '@/lib/utils'
import { matchSupermarketByBranch, type SupermarketLookup } from '@/lib/supermarket-match'
import {
  computeImportSaleAmounts,
  formatShopPriceBreakdown,
  resolveProductPricing,
  type ProductPricingFields,
} from '@/lib/product-pricing'

export interface ProductLookup extends ProductPricingFields {
  id: string
  name: string
  vendor_id: string
  vendor_price: number
  distrogh_markup: number
  barcode?: string | null
  sku?: string | null
}

export interface VendorLookup {
  id: string
  name: string
}

interface ColumnMap {
  product?: number
  description?: number
  code?: number
  qty?: number
  price?: number
  totalCost?: number
  vendorName?: number
  creditor?: number
  branch?: number
  store?: number
}

function normalise(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliseCode(str: string): string {
  return str.replace(/\s/g, '').trim()
}

function parseNumber(raw: unknown): number {
  return Number(String(raw ?? '').replace(/[^0-9.]/g, '')) || 0
}

function cellText(row: ExcelJS.Row, col?: number): string {
  if (!col) return ''
  const v = row.getCell(col).value
  if (v == null) return ''
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text?: string }).text ?? '').trim()
  }
  return String(v).trim()
}

function detectColumns(headerRow: ExcelJS.Row): ColumnMap {
  const headers: ColumnMap = {}
  headerRow.eachCell((cell, colNumber) => {
    const h = String(cell.value ?? '').toLowerCase().trim()
    if (h === 'store' || h === 'store code' || h === 'store_id') headers.store = colNumber
    else if (h === 'code' || h === 'product code' || h === 'barcode') headers.code = colNumber
    else if (h === 'description' || h === 'desc' || h === 'product description') headers.description = colNumber
    else if (h === 'qty' || h.includes('quantity')) headers.qty = colNumber
    else if (h.includes('tcost') || h === 'total cost') headers.totalCost = colNumber
    else if (h === 'name' && headers.vendorName == null) headers.vendorName = colNumber
    else if (h === 'creditor' || h === 'vendor') headers.creditor = colNumber
    else if (h === 'branch') headers.branch = colNumber
    else if (h.includes('product') && headers.product == null) headers.product = colNumber
    else if (h.includes('price') && headers.price == null && !h.includes('tcost')) headers.price = colNumber
  })
  return headers
}

function isPalaceFormat(headers: ColumnMap): boolean {
  return !!(headers.description && (headers.code || headers.qty))
}

export function matchVendorByName(name: string, vendors: VendorLookup[]): VendorLookup | null {
  const normName = normalise(name)
  if (!normName) return null

  let match = vendors.find((v) => normalise(v.name) === normName)
  if (match) return match

  match = vendors.find(
    (v) => normalise(v.name).includes(normName) || normName.includes(normalise(v.name))
  )
  return match ?? null
}

export function matchProduct(
  productName: string,
  productCode: string,
  products: ProductLookup[]
): ProductLookup | null {
  const normCode = normaliseCode(productCode)
  if (normCode) {
    const byCode = products.find((p) => {
      const barcode = normaliseCode(p.barcode ?? '')
      const sku = normaliseCode(p.sku ?? '')
      return (barcode && barcode === normCode) || (sku && sku === normCode)
    })
    if (byCode) return byCode
  }

  const normName = normalise(productName)
  if (!normName) return null

  let match = products.find((p) => normalise(p.name) === normName)
  if (match) return match

  match = products.find(
    (p) => normalise(p.name).includes(normName) || normName.includes(normalise(p.name))
  )
  return match ?? null
}

type SpreadsheetRowMeta = Pick<
  ParsedSaleRow,
  | 'product_name'
  | 'product_code'
  | 'spreadsheet_vendor_name'
  | 'spreadsheet_creditor'
  | 'vendor_id'
  | 'vendor_matched'
  | 'vendor_error'
  | 'branch'
  | 'store_code'
  | 'import_supermarket_id'
  | 'supermarket_matched'
  | 'supermarket_error'
>

function attachSupermarketMatch(
  base: SpreadsheetRowMeta,
  usesBranchMatching: boolean,
  supermarkets: SupermarketLookup[],
  reportingChainName?: string
): SpreadsheetRowMeta {
  if (!usesBranchMatching) {
    return {
      ...base,
      import_supermarket_id: null,
      supermarket_matched: false,
      supermarket_error: undefined,
    }
  }

  const branch = base.branch?.trim() ?? ''
  const storeCode = base.store_code?.trim() ?? ''
  if (!branch && !storeCode) {
    return {
      ...base,
      import_supermarket_id: null,
      supermarket_matched: false,
      supermarket_error: 'Branch not in spreadsheet',
    }
  }

  const matched = matchSupermarketByBranch(branch, storeCode, supermarkets)
  if (matched) {
    return {
      ...base,
      import_supermarket_id: matched.id,
      supermarket_matched: true,
      supermarket_error: undefined,
    }
  }

  const label = branch || storeCode
  const chainHint = reportingChainName?.trim()
    ? ` under “${reportingChainName.trim()}”`
    : ''
  return {
    ...base,
    import_supermarket_id: null,
    supermarket_matched: false,
    supermarket_error: `Branch “${label}” not found${chainHint} — add the outlet under Supermarkets`,
  }
}

const PRICE_TOLERANCE = 0.02

export function sheetUnitFromLineTotal(lineTotal: number, qty: number): number {
  if (qty <= 0 || lineTotal <= 0) return 0
  return roundMoney(lineTotal / qty)
}

function buildMatchedRow(
  base: SpreadsheetRowMeta,
  matched: ProductLookup,
  qty: number,
  sheetLineTotal: number,
  sheetUnitPrice: number
): ParsedSaleRow {
  const pricing = resolveProductPricing(matched)
  const catalogShopPrice = roundMoney(pricing.shopPrice)
  const sheetUnit = roundMoney(sheetUnitPrice)
  const lineTotal = roundMoney(sheetLineTotal > 0 ? sheetLineTotal : sheetUnit * qty)
  const useSheetPrice = sheetUnit > 0

  const amounts = useSheetPrice
    ? computeImportSaleAmounts(qty, sheetUnit, pricing.vendorPrice, lineTotal)
    : {
        unit_price: catalogShopPrice,
        total_sales: roundMoney(qty * catalogShopPrice),
        vendor_due: roundMoney(qty * pricing.vendorPrice),
        commission_amount: roundMoney(qty * (catalogShopPrice - pricing.vendorPrice)),
        price_warning: null as string | null,
      }

  const priceMismatch =
    useSheetPrice && Math.abs(catalogShopPrice - sheetUnit) > PRICE_TOLERANCE

  return {
    ...base,
    qty_sold: qty,
    sheet_line_total: lineTotal,
    sheet_unit_price: sheetUnit,
    catalog_shop_price: catalogShopPrice,
    unit_price: amounts.unit_price,
    total_sales: amounts.total_sales,
    commission_amount: amounts.commission_amount,
    vendor_due: amounts.vendor_due,
    product_id: matched.id,
    vendor_id: matched.vendor_id,
    commission_percent: 0,
    matched: true,
    price_mismatch: priceMismatch,
    price_note: priceMismatch
      ? `Recording at spreadsheet GHS ${sheetUnit.toFixed(2)}/unit (catalog distro ${formatShopPriceBreakdown(pricing)})`
      : undefined,
    price_warning: amounts.price_warning ?? undefined,
  }
}

function buildUnmatchedRow(
  base: SpreadsheetRowMeta,
  qty: number,
  sheetLineTotal: number,
  sheetUnitPrice: number
): ParsedSaleRow {
  const sheetUnit = roundMoney(sheetUnitPrice)
  const lineTotal = roundMoney(sheetLineTotal > 0 ? sheetLineTotal : sheetUnit * qty)
  return {
    ...base,
    qty_sold: qty,
    sheet_line_total: lineTotal,
    sheet_unit_price: sheetUnit,
    unit_price: sheetUnit,
    total_sales: roundMoney(qty * sheetUnit),
    commission_amount: 0,
    vendor_due: 0,
    product_id: null,
    commission_percent: 0,
    matched: false,
    error: 'Product not in database',
    price_mismatch: false,
  }
}

function buildSpreadsheetBase(params: {
  productName: string
  productCode: string
  vendorName: string
  creditor: string
  branch: string
  storeCode: string
  vendors: VendorLookup[]
  usesBranchMatching: boolean
  supermarkets: SupermarketLookup[]
  reportingChainName?: string
}): SpreadsheetRowMeta {
  const matchedVendor = params.vendorName ? matchVendorByName(params.vendorName, params.vendors) : null
  const base: SpreadsheetRowMeta = {
    product_name: params.productName,
    product_code: params.productCode || null,
    spreadsheet_vendor_name: params.vendorName || null,
    spreadsheet_creditor: params.creditor || null,
    vendor_id: matchedVendor?.id ?? null,
    vendor_matched: !!matchedVendor,
    vendor_error: params.vendorName && !matchedVendor
      ? `Vendor "${params.vendorName}" not in database — select a vendor when adding the product`
      : undefined,
    branch: params.branch || null,
    store_code: params.storeCode || null,
    import_supermarket_id: null,
    supermarket_matched: false,
    supermarket_error: undefined,
  }
  return attachSupermarketMatch(
    base,
    params.usesBranchMatching,
    params.supermarkets,
    params.reportingChainName
  )
}

/** Stable key for grouping spreadsheet rows that share the same product identity. */
export function getImportRowLinkKey(
  row: Pick<ParsedSaleRow, 'product_code' | 'product_name'>
): string {
  const code = row.product_code?.trim() ?? ''
  const name = row.product_name?.trim() ?? ''
  if (code) return `code:${code.toLowerCase()}`
  return `name:${name.toLowerCase()}`
}

export function productsForImportRow(
  row: Pick<ParsedSaleRow, 'vendor_id'>,
  products: ProductLookup[]
): ProductLookup[] {
  const vendorId = row.vendor_id?.trim()
  const list = vendorId ? products.filter((p) => p.vendor_id === vendorId) : products
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

function resolveRowProduct(
  base: SpreadsheetRowMeta,
  products: ProductLookup[],
  manualProductLinks: Record<string, string>
): { product: ProductLookup | null; linkSource: 'manual' | 'auto' | null; manualId: string | null } {
  const linkKey = getImportRowLinkKey({
    product_code: base.product_code,
    product_name: base.product_name,
  })
  const manualId = manualProductLinks[linkKey] ?? null

  if (manualId) {
    const manualProduct = products.find((p) => p.id === manualId) ?? null
    if (manualProduct) {
      return { product: manualProduct, linkSource: 'manual', manualId }
    }
    return { product: null, linkSource: 'manual', manualId }
  }

  const autoProduct = matchProduct(base.product_name, base.product_code ?? '', products)
  if (autoProduct) {
    return { product: autoProduct, linkSource: 'auto', manualId: null }
  }

  return { product: null, linkSource: null, manualId: null }
}

export function rematchImportRows(
  rows: ParsedSaleRow[],
  products: ProductLookup[],
  vendors: VendorLookup[],
  supermarkets: SupermarketLookup[] = [],
  usesBranchMatching = false,
  manualProductLinks: Record<string, string> = {},
  reportingChainName?: string
): ImportPreview {
  const rematched = rows.map((row) => {
    const base = buildSpreadsheetBase({
      productName: row.product_name?.trim() ?? '',
      productCode: row.product_code?.trim() ?? '',
      vendorName: row.spreadsheet_vendor_name?.trim() ?? '',
      creditor: row.spreadsheet_creditor?.trim() ?? '',
      branch: row.branch?.trim() ?? '',
      storeCode: row.store_code?.trim() ?? '',
      vendors,
      usesBranchMatching,
      supermarkets,
      reportingChainName,
    })

    const sheetUnit =
      row.sheet_unit_price ??
      sheetUnitFromLineTotal(row.sheet_line_total ?? 0, row.qty_sold) ??
      row.unit_price
    const sheetLine =
      row.sheet_line_total ?? roundMoney(sheetUnit * row.qty_sold)

    const { product, linkSource, manualId } = resolveRowProduct(base, products, manualProductLinks)

    if (product) {
      return {
        ...buildMatchedRow(base, product, row.qty_sold, sheetLine, sheetUnit),
        manual_product_id: manualId,
        matched_product_name: product.name,
        product_link_source: linkSource,
      }
    }

    const unmatched = buildUnmatchedRow(base, row.qty_sold, sheetLine, sheetUnit)
    if (manualId) {
      return {
        ...unmatched,
        manual_product_id: manualId,
        product_link_source: 'manual' as const,
        error: 'Selected product not found — choose another from the vendor list',
      }
    }
    return unmatched
  })

  return buildImportPreview(rematched, usesBranchMatching)
}

function buildImportPreview(rows: ParsedSaleRow[], usesBranchMatching = false): ImportPreview {
  const unmatched = Array.from(
    new Set(
      rows
        .filter((r) => !r.matched)
        .map((r) => r.product_code?.trim() || r.product_name)
        .filter(Boolean)
    )
  )
  const unmatched_branches = usesBranchMatching
    ? Array.from(
        new Set(
          rows
            .filter((r) => r.matched && !r.supermarket_matched)
            .map((r) => r.branch?.trim() || r.store_code?.trim() || '')
            .filter((v): v is string => !!v)
        )
      )
    : []
  const importableRows = rows.filter((r) => isRowReadyToImport(r, usesBranchMatching))
  const price_mismatch_count = rows.filter((r) => r.matched && r.price_mismatch).length

  return {
    rows,
    unmatched,
    unmatched_branches,
    uses_branch_matching: usesBranchMatching,
    price_mismatch_count,
    totalSales: importableRows.reduce((s, r) => s + r.total_sales, 0),
    totalCommission: importableRows.reduce((s, r) => s + r.commission_amount, 0),
    totalVendorDue: importableRows.reduce((s, r) => s + r.vendor_due, 0),
    rowCount: rows.length,
  }
}

export function isRowReadyToImport(row: ParsedSaleRow, usesBranchMatching: boolean): boolean {
  return (
    row.matched &&
    (!usesBranchMatching || !!row.supermarket_matched)
  )
}

export async function parseExcelFile(
  buffer: ArrayBuffer,
  products: ProductLookup[],
  vendors: VendorLookup[] = [],
  supermarkets: SupermarketLookup[] = []
): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets[0]

  if (!worksheet) {
    throw new Error('No worksheet found in Excel file')
  }

  const headers = detectColumns(worksheet.getRow(1))
  const palace = isPalaceFormat(headers)
  const usesBranchMatching = palace && !!headers.branch
  const parsed: ParsedSaleRow[] = []

  const rowCount = worksheet.rowCount ?? 0
  for (let rowNumber = 2; rowNumber <= rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber)

    let productName = ''
    let productCode = ''
    let qty = 0
    let vendorName = ''
    let creditor = ''
    let branch = ''
    let storeCode = ''
    let sheetLineTotal = 0
    let sheetUnitPrice = 0

    if (palace) {
      productName = cellText(row, headers.description)
      productCode = cellText(row, headers.code)
      qty = parseNumber(row.getCell(headers.qty ?? 0).value)
      const totalCost = parseNumber(row.getCell(headers.totalCost ?? 0).value)
      sheetLineTotal = roundMoney(totalCost)
      sheetUnitPrice = sheetUnitFromLineTotal(totalCost, qty)
      vendorName = cellText(row, headers.vendorName)
      creditor = cellText(row, headers.creditor)
      branch = cellText(row, headers.branch)
      storeCode = cellText(row, headers.store)
    } else {
      productName = cellText(row, headers.product ?? headers.description ?? 1)
      productCode = cellText(row, headers.code)
      qty = parseNumber(row.getCell(headers.qty ?? 2).value)
      const totalCost = parseNumber(row.getCell(headers.totalCost ?? 0).value)
      if (totalCost > 0 && qty > 0) {
        sheetLineTotal = roundMoney(totalCost)
        sheetUnitPrice = sheetUnitFromLineTotal(totalCost, qty)
      } else {
        sheetUnitPrice = parseNumber(row.getCell(headers.price ?? 3).value)
        sheetLineTotal = roundMoney(sheetUnitPrice * qty)
      }
      branch = cellText(row, headers.branch)
      storeCode = cellText(row, headers.store)
    }

    if (!productName || qty === 0) continue

    const base = buildSpreadsheetBase({
      productName,
      productCode,
      vendorName,
      creditor,
      branch,
      storeCode,
      vendors,
      usesBranchMatching,
      supermarkets,
    })

    const matchedProduct = matchProduct(productName, productCode, products)
    if (matchedProduct) {
      parsed.push(buildMatchedRow(base, matchedProduct, qty, sheetLineTotal, sheetUnitPrice))
    } else {
      parsed.push(buildUnmatchedRow(base, qty, sheetLineTotal, sheetUnitPrice))
    }
  }

  return buildImportPreview(parsed, usesBranchMatching)
}

export async function generateSampleExcel(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sales')

  worksheet.columns = [
    { header: 'store', key: 'store', width: 10 },
    { header: 'BRANCH', key: 'branch', width: 12 },
    { header: 'Code', key: 'code', width: 16 },
    { header: 'description', key: 'description', width: 36 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'TCostEx', key: 'tcost', width: 12 },
    { header: 'creditor', key: 'creditor', width: 10 },
    { header: 'NAME', key: 'name', width: 28 },
  ]

  worksheet.addRows([
    {
      store: 1050,
      branch: 'ADENTA',
      code: '323238735011',
      description: 'NATURE FROM ADDYS CHARCOAL POW',
      qty: 1,
      tcost: 25.0,
      creditor: 504,
      name: 'FARMER TORKS GREENERIES',
    },
    {
      store: 1050,
      branch: 'ADENTA',
      code: '603400034498',
      description: 'FARMER TOKES COCOPEAT 5L',
      qty: 3,
      tcost: 90.0,
      creditor: 504,
      name: 'FARMER TORKS GREENERIES',
    },
  ])

  worksheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
