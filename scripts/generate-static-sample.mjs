/**
 * Generate a static test Excel file with dummy data for import sales testing.
 * Run once: node scripts/generate-static-sample.mjs
 * Output: sample_sales_test.xlsx (committed to repo for reuse)
 */

import ExcelJS from 'exceljs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outPath = resolve(root, 'sample_sales_test.xlsx')

const staticRows = [
  { product: 'Milo 400g', qty: 24, price: 25.0 },
  { product: 'Indomie Chicken 70g', qty: 100, price: 1.8 },
  { product: 'Peak Milk 170g Tin', qty: 48, price: 7.5 },
  { product: 'Pampelona Sardines', qty: 36, price: 6.0 },
  { product: 'Lipton Yellow Label', qty: 20, price: 15.0 },
  { product: 'Maggi Cube', qty: 50, price: 0.5 },
  { product: 'Coca-Cola 500ml', qty: 72, price: 3.5 },
  { product: 'Rice 1kg', qty: 12, price: 8.0 }
]

async function main() {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Sales')

  worksheet.columns = [
    { header: 'Product', key: 'product', width: 35 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Price', key: 'price', width: 15 }
  ]

  worksheet.getRow(1).font = { bold: true }
  worksheet.addRows(staticRows)

  await workbook.xlsx.writeFile(outPath)
  console.log(`Generated ${outPath} with ${staticRows.length} test rows`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
