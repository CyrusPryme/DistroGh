import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'

const file = process.argv[2] ?? resolve(process.cwd(), 'discrepancies fix/migration-deliveries-template_ 2 correction.xlsx')

async function main() {
  const { rows } = await parseWorkbook(readFileSync(file))
  console.log('File:', file)
  console.log('Rows:', rows.length)
  for (const r of rows) {
    console.log(JSON.stringify(r))
  }
  const byProd = new Map<string, number>()
  for (const r of rows) {
    const k = String(r.product_name ?? '')
    if (!k || /palm oil/i.test(k)) continue
    byProd.set(k, (byProd.get(k) ?? 0) + Number(r.quantity ?? 0))
  }
  console.log('\nTotals by product (excl demo):')
  for (const [k, v] of [...byProd.entries()].sort()) console.log(`  ${k}: ${v}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
