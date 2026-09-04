import { describe, expect, it } from 'vitest'
import {
  buildEarliestDeliveryByBarcode,
  computeReturnDeliveryLagStats,
  fixReturnDateBeforeDelivery,
  median,
} from '@/lib/migration/return-date-fix'

describe('return-date-fix', () => {
  it('median', () => {
    expect(median([10, 210, 400])).toBe(210)
    expect(median([7, 8])).toBe(8)
  })

  it('buildEarliestDeliveryByBarcode picks min date', () => {
    const map = buildEarliestDeliveryByBarcode([
      { barcode: '111', delivery_date: '2026-04-13' },
      { barcode: '111', delivery_date: '2025-12-13' },
    ])
    expect(map.get('111')).toBe('2025-12-13')
  })

  it('uses sibling return date when available', () => {
    const result = fixReturnDateBeforeDelivery(
      '2025-09-29',
      '2025-11-24',
      ['2026-01-24'],
      210
    )
    expect(result.adjusted).toBe(true)
    expect(result.returnDate).toBe('2026-01-24')
  })

  it('uses +365 year typo when no sibling', () => {
    const result = fixReturnDateBeforeDelivery('2025-12-02', '2025-12-31', [], 210)
    expect(result.returnDate).toBe('2026-12-02')
  })

  it('uses median lag when year typo still too early', () => {
    const result = fixReturnDateBeforeDelivery('2024-01-01', '2025-12-13', [], 210)
    expect(result.returnDate).toBe('2026-07-11')
  })

  it('computeReturnDeliveryLagStats from sample rows', () => {
    const deliveries = buildEarliestDeliveryByBarcode([
      { barcode: '603400090204', delivery_date: '2025-11-24' },
    ])
    const stats = computeReturnDeliveryLagStats(
      [
        { barcode: '603400090204', return_date: '2025-09-29' },
        { barcode: '603400090204', return_date: '2026-01-24' },
      ],
      deliveries
    )
    expect(stats.validReturnDatesByBarcode.get('603400090204')).toEqual(['2026-01-24'])
    expect(stats.medianLagDays).toBe(61)
  })
})
