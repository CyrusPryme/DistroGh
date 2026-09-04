/**
 * Build supplemental delivery rows for products that appear in returns but not deliveries.
 */
import { migrationStr } from '@/lib/migration/fix-workbook'
import { toSqlDate } from '@/lib/utils'

/** Barcodes flagged as missing delivery during returns maiden analysis. */
export const RETURNS_GAP_BARCODES = [
  '342787062899',
  '342787014007',
  '603400026503',
  '603602777111',
  '603400026515',
] as const

const GAP_SET = new Set<string>(RETURNS_GAP_BARCODES)

export function deliveryDateBeforeReturn(returnDateIso: string, daysBefore = 30): string {
  const d = new Date(`${returnDateIso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - daysBefore)
  return toSqlDate(d.toISOString())
}

/**
 * One delivery row per gap barcode — quantity/date derived from earliest return for that product.
 */
export function buildDeliveryRowsFromReturnsGaps(
  returnRows: Record<string, unknown>[],
  catalogByBarcode: Map<string, string>
): Record<string, unknown>[] {
  const byBarcode = new Map<
    string,
    { product_name: string; quantity: number; return_date: string; branch: string }
  >()

  for (const row of returnRows) {
    const bc = migrationStr(row.barcode)
    if (!GAP_SET.has(bc)) continue
    const ret = toSqlDate(migrationStr(row.return_date))
    const qty = Number(row.quantity ?? row.qty)
    if (!ret || !Number.isFinite(qty) || qty <= 0) continue

    const existing = byBarcode.get(bc)
    if (!existing || ret < existing.return_date) {
      byBarcode.set(bc, {
        product_name: migrationStr(row.product_name),
        quantity: qty,
        return_date: ret,
        branch: 'SPINTEX',
      })
    } else if (ret === existing.return_date) {
      existing.quantity += qty
    }
  }

  const out: Record<string, unknown>[] = []
  for (const bc of RETURNS_GAP_BARCODES) {
    const gap = byBarcode.get(bc)
    if (!gap) continue
    const productName = catalogByBarcode.get(bc) ?? gap.product_name
    out.push({
      supermarket_name: 'PALACE',
      product_name: productName,
      quantity: gap.quantity,
      delivery_date: deliveryDateBeforeReturn(gap.return_date),
      branch: gap.branch,
      store_code: '1004',
      barcode: bc,
      _gap_source: `Synthesized from returns (return ${gap.return_date}, qty ${gap.quantity})`,
    })
  }
  return out
}

export function isGapSupplementRow(row: Record<string, unknown>): boolean {
  return Boolean(migrationStr(row._gap_source))
}
