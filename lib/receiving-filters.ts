/**
 * Shared helpers for Receiving page filter labels and product search.
 */

export function normalizeProductSearch(query: string): string {
  return query.trim().toLowerCase()
}

export function productMatchesSearch(productName: string, query: string): boolean {
  const q = normalizeProductSearch(query)
  if (!q) return true
  return productName.toLowerCase().includes(q)
}

export function formatReceivingDateRangeLabel(from: string, to: string): string | null {
  if (from && to) return ` from ${from} to ${to}`
  if (from) return ` from ${from}`
  if (to) return ` until ${to}`
  return null
}

export function receivingLogEmptyMessage(opts: {
  isVendor: boolean
  vendorName: string | null
  hasVendorFilter: boolean
  hasDateFilter: boolean
  dateRangeLabel: string | null
}): { title: string; description: string } {
  const { isVendor, vendorName, hasVendorFilter, hasDateFilter, dateRangeLabel } = opts
  const vendorPhrase = vendorName ? ` for ${vendorName}` : hasVendorFilter ? ' for the selected vendor' : ''
  const datePhrase = dateRangeLabel ?? ''

  if (hasVendorFilter || hasDateFilter || isVendor) {
    return {
      title: 'No items found for the selected filters',
      description: isVendor
        ? `No receipt history${vendorPhrase}${datePhrase}. Try widening the date range.`
        : `No receipt history${vendorPhrase}${datePhrase}. Clear filters or record a new intake.`,
    }
  }

  return {
    title: 'No intakes recorded',
    description: 'Record stock when it arrives at DistroGH from vendors.',
  }
}

export function receivingStockEmptyMessage(opts: {
  isVendor: boolean
  vendorName: string | null
  hasVendorFilter: boolean
  hasProductSearch: boolean
  productSearch: string
}): { title: string; description: string } {
  const { isVendor, vendorName, hasVendorFilter, hasProductSearch, productSearch } = opts

  if (hasProductSearch) {
    return {
      title: 'No matching products',
      description: `No stock summary rows match “${productSearch.trim()}”. Try a different search term.`,
    }
  }

  const vendorPhrase = vendorName ? ` for ${vendorName}` : hasVendorFilter ? ' for the selected vendor' : ''

  return {
    title: hasVendorFilter || isVendor ? 'No items found for the selected vendor' : 'No warehouse stock on hand',
    description:
      hasVendorFilter || isVendor
        ? `No products with warehouse activity${vendorPhrase}. Receipts may exist only in the log tab.`
        : 'Record intakes or import receiving history to see aggregated balances here.',
  }
}
