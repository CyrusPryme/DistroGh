/**
 * List product barcodes in fixed sales file that are missing from production.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { parseWorkbook } from '@/lib/migration/parse'

const FILE = resolve(process.cwd(), 'sales migration/migration-sales-FIXED.xlsx')

async function main() {
  const { rows } = await parseWorkbook(readFileSync(FILE))
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

  const { rows: products } = await pool.query<{ id: string; name: string; barcode: string | null }>(
    `SELECT id, name, barcode FROM public.products WHERE deleted_at IS NULL`
  )
  const byBarcode = new Map(
    products.filter((p) => p.barcode).map((p) => [String(p.barcode).toLowerCase(), p])
  )

  const codeCounts = new Map<string, number>()
  for (const r of rows) {
    const c = String(r.code ?? '').trim()
    if (!c) continue
    codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1)
  }

  const unmatched: Array<{ code: string; count: number }> = []
  for (const [code, count] of codeCounts) {
    if (!byBarcode.has(code.toLowerCase())) unmatched.push({ code, count })
  }
  unmatched.sort((a, b) => b.count - a.count)

  console.log('Unmatched barcodes:', unmatched.length)
  console.log('Rows affected:', unmatched.reduce((s, u) => s + u.count, 0))
  console.log('')
  for (const u of unmatched) {
    console.log(`${String(u.count).padStart(3)}x  ${u.code}`)
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
