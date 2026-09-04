/**
 * Analyze return vs delivery dates to propose chronology fixes.
 * Usage: npx tsx scripts/analyze-return-date-fixes.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseWorkbook } from '@/lib/migration/parse'
import { migrationStr } from '@/lib/migration/fix-workbook'
import { toSqlDate } from '@/lib/utils'

const DELIVERIES = resolve(process.cwd(), 'deliveries migrations/DELIVERIES_DISTRO_MAIDEN-FIXED.xlsx')
const RETURNS = resolve(process.cwd(), 'returned migration/returns-NEW_corrected (1).xlsx')

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00.000Z`)
  const b = new Date(`${toIso}T00:00:00.000Z`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return toSqlDate(d.toISOString())
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

async function main() {
  const { rows: deliveries } = await parseWorkbook(readFileSync(DELIVERIES))
  const { rows: returns } = await parseWorkbook(readFileSync(RETURNS))

  const earliestDeliveryByBarcode = new Map<string, string>()
  const allDeliveryDatesByBarcode = new Map<string, string[]>()
  for (const row of deliveries) {
    const bc = migrationStr(row.barcode)
    const d = toSqlDate(migrationStr(row.delivery_date))
    if (!bc || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    const list = allDeliveryDatesByBarcode.get(bc) ?? []
    list.push(d)
    allDeliveryDatesByBarcode.set(bc, list)
    const prev = earliestDeliveryByBarcode.get(bc)
    if (!prev || d < prev) earliestDeliveryByBarcode.set(bc, d)
  }

  const lags: number[] = []
  const returnDates: string[] = []
  const issues: Array<Record<string, unknown>> = []

  for (const row of returns) {
    const bc = migrationStr(row.barcode)
    const ret = toSqlDate(migrationStr(row.return_date))
    returnDates.push(ret)
    const earliest = earliestDeliveryByBarcode.get(bc)
    if (!earliest) continue
    if (ret >= earliest) {
      lags.push(daysBetween(earliest, ret))
    } else {
      issues.push({
        product: row.product_name,
        barcode: bc,
        return_date: ret,
        earliest_delivery: earliest,
        days_before: daysBetween(ret, earliest),
        all_deliveries: allDeliveryDatesByBarcode.get(bc),
      })
    }
  }

  console.log('=== DELIVERY DATE STATS (all returns file) ===')
  console.log('Valid return→delivery lags (days):', lags.length)
  if (lags.length) {
    console.log('  min:', Math.min(...lags), 'max:', Math.max(...lags))
    console.log('  median:', median(lags), 'mean:', Math.round(lags.reduce((a, b) => a + b, 0) / lags.length))
  }

  const dateCounts = new Map<string, number>()
  for (const d of returnDates) dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1)
  console.log('\n=== COMMON RETURN DATES (top 10) ===')
  ;[...dateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([d, c]) => console.log(`  ${c}x ${d}`))

  console.log('\n=== CHRONOLOGY ISSUES ===')
  const medLag = median(lags) || 90
  for (const issue of issues) {
    const earliest = String(issue.earliest_delivery)
    const proposedMedian = addDays(earliest, medLag)
    const proposed30 = addDays(earliest, 30)
    // nearest common return date on or after delivery
    const commonAfter = [...dateCounts.keys()]
      .filter((d) => d >= earliest)
      .sort(
        (a, b) =>
          (dateCounts.get(b) ?? 0) - (dateCounts.get(a) ?? 0) ||
          daysBetween(earliest, a) - daysBetween(earliest, b)
      )[0]
    console.log({
      ...issue,
      proposed_median_lag: `${medLag}d → ${proposedMedian}`,
      proposed_delivery_plus_30: proposed30,
      proposed_common_return_date: commonAfter ?? null,
    })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
