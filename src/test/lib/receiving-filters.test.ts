/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  formatReceivingDateRangeLabel,
  productMatchesSearch,
  receivingLogEmptyMessage,
  receivingStockEmptyMessage,
} from '@/lib/receiving-filters'

describe('receiving filters', () => {
  it('matches product search case-insensitively', () => {
    expect(productMatchesSearch('ADEPA BUTTER CEREAL', 'adepa')).toBe(true)
    expect(productMatchesSearch('ADEPA BUTTER CEREAL', 'honey')).toBe(false)
    expect(productMatchesSearch('ADEPA BUTTER CEREAL', '')).toBe(true)
  })

  it('formats date range labels', () => {
    expect(formatReceivingDateRangeLabel('2025-01-01', '2025-12-31')).toContain('2025-01-01')
    expect(formatReceivingDateRangeLabel('', '')).toBeNull()
  })

  it('returns vendor-specific log empty copy', () => {
    const msg = receivingLogEmptyMessage({
      isVendor: false,
      vendorName: 'ADEPA CEREAL',
      hasVendorFilter: true,
      hasDateFilter: false,
      dateRangeLabel: null,
    })
    expect(msg.title).toContain('No items found')
    expect(msg.description).toContain('ADEPA CEREAL')
  })

  it('returns search-specific stock empty copy', () => {
    const msg = receivingStockEmptyMessage({
      isVendor: false,
      vendorName: null,
      hasVendorFilter: false,
      hasProductSearch: true,
      productSearch: 'honey',
    })
    expect(msg.title).toBe('No matching products')
  })
})
