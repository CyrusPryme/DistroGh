import ExcelJS from 'exceljs'
import { ParsedSaleRow, ImportPreview, ExcelSaleRow } from '@/types'
import { roundMoney } from '@/lib/utils'

interface ProductLookup {
  id: string
  name: string
  vendor_id: string
  selling_price?: number
  vendor_price: number
  distrogh_markup: number
}

// Normalise strings for fuzzy matching (lowercase, no extra spaces, remove punctuation)
function normalise(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchProduct(
  name: string,
  products: ProductLookup[]
): ProductLookup | null {
  const normName = normalise(name)

  // 1. Exact match
  let match = products.find(p => normalise(p.name) === normName)
  if (match) return match

  // 2. Includes match
  match = products.find(p => normalise(p.name).includes(normName) || normName.includes(normalise(p.name)))
  if (match) return match

  return null
}

export async function parseExcelFile(
  buffer: ArrayBuffer,
  products: ProductLookup[]
): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const worksheet = workbook.worksheets[0]

  if (!worksheet) {
    throw new Error('No worksheet found in Excel file')
  }

  const parsed: ParsedSaleRow[] = []
  const unmatched: string[] = []

  // Get header row to find column indices
  const headerRow = worksheet.getRow(1)
  const headers: Record<string, number> = {}
  
  headerRow.eachCell((cell, colNumber) => {
    const headerValue = String(cell.value || '').toLowerCase().trim()
    if (headerValue.includes('product')) headers.product = colNumber
    else if (headerValue.includes('qty') || headerValue.includes('quantity')) headers.qty = colNumber
    else if (headerValue.includes('price')) headers.price = colNumber
  })

  // Process data rows (rowCount can be 0/undefined for empty sheets)
  const rowCount = worksheet.rowCount ?? 0
  for (let rowNumber = 2; rowNumber <= rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber)
    
    const productName = String(row.getCell(headers.product || 1).value || '').trim()
    const qtyRaw = row.getCell(headers.qty || 2).value
    const priceRaw = row.getCell(headers.price || 3).value

    const qty = Number(String(qtyRaw || '').replace(/[^0-9.]/g, '')) || 0
    const price = Number(String(priceRaw || '').replace(/[^0-9.]/g, '')) || 0

    if (!productName || qty === 0) continue

    const matched = matchProduct(productName, products)

    if (!matched) {
      if (!unmatched.includes(productName)) {
        unmatched.push(productName)
      }
      parsed.push({
        product_name: productName,
        qty_sold: qty,
        unit_price: price,
        total_sales: qty * price,
        commission_amount: 0,
        vendor_due: 0,
        product_id: null,
        vendor_id: null,
        commission_percent: 0,
        matched: false,
        error: `No product found matching "${productName}"`,
      })
      continue
    }

    // New model: no commission deducted from vendor base price.
    // Shops see base/unit price = vendor_price + distrogh_markup from the product record.
    // vendor_due = qty * vendor_price; commission_amount = qty * distrogh_markup.
    const unitPrice = roundMoney(matched.vendor_price + matched.distrogh_markup)
    const totalSales = roundMoney(qty * unitPrice)
    const vendorDue = roundMoney(qty * matched.vendor_price)
    const commissionAmount = roundMoney(qty * matched.distrogh_markup)

    parsed.push({
      product_name: productName,
      qty_sold: qty,
      unit_price: unitPrice,
      total_sales: totalSales,
      commission_amount: commissionAmount,
      vendor_due: vendorDue,
      product_id: matched.id,
      vendor_id: matched.vendor_id,
      commission_percent: 0,
      matched: true,
    })
  }

  const matchedRows = parsed.filter(r => r.matched)

  return {
    rows: parsed,
    unmatched,
    totalSales: matchedRows.reduce((s, r) => s + r.total_sales, 0),
    totalCommission: matchedRows.reduce((s, r) => s + r.commission_amount, 0),
    totalVendorDue: matchedRows.reduce((s, r) => s + r.vendor_due, 0),
    rowCount: parsed.length,
  }
}

export async function generateSampleExcel(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sales')
  
  // Add headers
  worksheet.columns = [
    { header: 'Product', key: 'product', width: 30 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Price', key: 'price', width: 15 }
  ]
  
  // Add sample data
  worksheet.addRows([
    { product: 'Milo 400g', qty: 24, price: 25.00 },
    { product: 'Indomie Chicken 70g', qty: 100, price: 1.80 },
    { product: 'Peak Milk 170g Tin', qty: 48, price: 7.50 },
    { product: 'Pampelona Sardines', qty: 36, price: 6.00 },
    { product: 'Lipton Yellow Label', qty: 20, price: 15.00 }
  ])
  
  // Style header row
  worksheet.getRow(1).font = { bold: true }
  
  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
