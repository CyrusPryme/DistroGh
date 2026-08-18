import ExcelJS from 'exceljs'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/analyze-palace-sales.mjs <xlsx-path>')
  process.exit(1)
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(path)

console.log('Sheets:', wb.worksheets.map((w) => `${w.name}(${w.rowCount})`).join(', '))

for (const ws of wb.worksheets) {
  if (ws.rowCount < 5) continue
  const row1 = ws.getRow(1)
  const headers = []
  row1.eachCell({ includeEmpty: false }, (c, i) => headers.push(String(c.value).trim()))
  if (!headers.some((h) => /qty|description|paid|month/i.test(h))) continue

  console.log(`\n=== ${ws.name} rows: ${ws.rowCount} ===`)
  console.log('Headers:', headers.join(' | '))

  const paidIdx = headers.findIndex((h) => /^paid$/i.test(h))
  const monthIdx = headers.findIndex((h) => /^month$/i.test(h))
  const paidVals = new Map()
  let paidNonBlank = 0
  const limit = Math.min(ws.rowCount, 3000)
  for (let r = 2; r <= limit; r++) {
    const row = ws.getRow(r)
    if (paidIdx >= 0) {
      const paid = row.getCell(paidIdx + 1).value
      if (paid != null && paid !== '') {
        paidNonBlank++
        const k = String(paid)
        paidVals.set(k, (paidVals.get(k) || 0) + 1)
      }
    }
  }
  console.log('PAID non-blank (first 3000 rows):', paidNonBlank)
  console.log('PAID unique samples:', [...paidVals.entries()].slice(0, 12))

  const months = new Set()
  for (let r = 2; r <= Math.min(ws.rowCount, 500); r++) {
    if (monthIdx >= 0) {
      const m = ws.getRow(r).getCell(monthIdx + 1).value
      if (m) months.add(String(m))
    }
  }
  console.log('MONTH values:', [...months])

  const row2 = {}
  headers.forEach((h, i) => {
    row2[h] = ws.getRow(2).getCell(i + 1).value
  })
  console.log('Sample row 2:', JSON.stringify(row2, null, 0))
}
