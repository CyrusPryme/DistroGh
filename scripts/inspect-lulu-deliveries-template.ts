import { readFileSync } from 'node:fs'
import { parseWorkbook } from '@/lib/migration/parse'

const path = 'discrepancies fix/migration-deliveries-template_LULU SHITO.xlsx'

async function main() {
  const { rows } = await parseWorkbook(readFileSync(path))
  const lulu = rows.filter((r) => /LULU/i.test(String(r.product_name ?? '')))
  console.log('Total data rows:', rows.length)
  for (const r of rows) {
    console.log('ROW', JSON.stringify(r))
  }
  console.log('Lulu rows:', lulu.length)
  for (const r of lulu) {
    console.log(
      [
        r.product_name,
        `qty=${r.quantity}`,
        `date=${r.delivery_date}`,
        `branch=${r.branch ?? ''}`,
        `barcode=${r.barcode ?? ''}`,
      ].join(' | ')
    )
  }
  const byProd = new Map<string, number>()
  for (const r of lulu) {
    const k = String(r.product_name)
    byProd.set(k, (byProd.get(k) ?? 0) + Number(r.quantity ?? 0))
  }
  console.log('\nTotals:')
  for (const [k, v] of byProd) console.log(`  ${k}: ${v}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
