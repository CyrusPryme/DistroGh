import type { MigrationEntityType } from '@/lib/migration/types'

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/**
 * Detect entity type from filename + column headers.
 * Reuses sales/Palace heuristics when code/description/qty present.
 */
export function detectEntityType(
  filename: string,
  columns: string[]
): MigrationEntityType | null {
  const fn = filename.toLowerCase()
  const cols = columns.map(norm)
  const has = (...names: string[]) => names.some((n) => cols.includes(norm(n)))

  if (/vendor.?doc|fda/.test(fn) || (has('fda_certificate_expiry_date') && has('vendor_name'))) {
    return 'vendor_documents'
  }
  if (/opening.?bal/.test(fn) || (has('balance') && has('vendor_name') && has('as_of_date'))) {
    return 'opening_balances'
  }
  if (/service.?charge/.test(fn) || (has('years_paid') || has('expires_at')) && has('vendor_name')) {
    return 'service_charges'
  }
  if (/payout/.test(fn) || (has('amount_paid') && has('vendor_name'))) return 'payouts'
  if (/deduct/.test(fn) || (has('amount') && has('deduction_date') && has('vendor_name'))) {
    return 'deductions'
  }
  if (/return/.test(fn) || (has('reason') && has('quantity') && (has('product_name') || has('product')))) {
    return 'returns'
  }
  // Palace / sales excel (store_name + MONTH + PAID are common on Palace exports)
  if (
    /sale/.test(fn) ||
    (has('qty') &&
      (has('description') || has('product') || has('code')) &&
      (has('tcostex') ||
        has('branch') ||
        has('storename') ||
        has('name') ||
        has('month') ||
        has('paymenttosupplier')))
  ) {
    return 'sales'
  }
  if (/deliver/.test(fn) || (has('delivery_date') && has('product_name'))) return 'deliveries'
  if (/intake|receiv|warehouse|receipt/.test(fn) || (has('received_date') && has('quantity'))) {
    return 'intakes'
  }
  if (/supermarket|outlet|branch/.test(fn) || (has('branch') && has('name') && !has('qty'))) {
    return 'supermarkets'
  }
  if (/categor/.test(fn) || (has('name') && columns.length <= 3 && !has('vendor_name') && !has('vendor_price'))) {
    if (/categor/.test(fn)) return 'categories'
  }
  if (/product|sku|barcode/.test(fn) || (has('vendor_price') && (has('vendor_name') || has('name')))) {
    return 'products'
  }
  if (/vendor|supplier/.test(fn) || (has('momo_network') || has('commission_rate'))) {
    return 'vendors'
  }
  if (/categor/.test(fn)) return 'categories'
  if (/chain/.test(fn)) return 'supermarket_chains'

  return null
}
