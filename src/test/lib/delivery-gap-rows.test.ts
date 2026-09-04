import { describe, expect, it } from 'vitest'
import { buildDeliveryRowsFromReturnsGaps, deliveryDateBeforeReturn } from '@/lib/migration/delivery-gap-rows'

describe('delivery-gap-rows', () => {
  it('deliveryDateBeforeReturn subtracts days in UTC', () => {
    expect(deliveryDateBeforeReturn('2026-04-16', 30)).toBe('2026-03-17')
  })

  it('builds one row per gap barcode from returns', () => {
    const rows = buildDeliveryRowsFromReturnsGaps(
      [
        {
          product_name: 'TROPICA JUDIA BEAN 100G',
          barcode: '342787062899',
          quantity: 5,
          return_date: '2026-04-16',
          branch: 'SPINTEX',
        },
        {
          product_name: 'CSL TOILET CLEANER 500ML',
          barcode: '603400026515',
          quantity: 4,
          return_date: '2026-08-12',
          branch: 'SPINTEX',
        },
      ],
      new Map([['342787062899', 'TROPICA JUDIA BEAN SEED 100G']])
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].barcode).toBe('342787062899')
    expect(rows[0].product_name).toBe('TROPICA JUDIA BEAN SEED 100G')
    expect(rows[0].delivery_date).toBe('2026-03-17')
    expect(rows[0].branch).toBe('SPINTEX')
  })
})
