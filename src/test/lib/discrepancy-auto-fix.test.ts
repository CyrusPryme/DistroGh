/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  classifyDeliveryGap,
  classifyIntakeGap,
  classifyInventoryGap,
  impliedExpectedShelf,
  spintexDeliveryGapQty,
} from '@/lib/migration/discrepancy-auto-fix'
import type { StockChainProductRow } from '@/lib/migration/stock-chain-data'

const base = (over: Partial<StockChainProductRow>): StockChainProductRow => ({
  product_id: '1',
  barcode: '123',
  product_name: 'Test Product',
  vendor_name: 'Vendor A',
  received: 100,
  delivered_all: 100,
  delivered_palace: 50,
  delivered_palace_chain: 50,
  delivered_palace_other: 0,
  sold_palace: 30,
  returned_palace: 10,
  inventory_palace: 50,
  expected_shelf: 10,
  shelf_variance: 40,
  warehouse_over_delivered: 0,
  earliest_intake: '2025-06-01',
  earliest_delivery: '2025-07-01',
  earliest_delivery_spintex: '2025-07-01',
  earliest_sale: '2025-08-01',
  earliest_return: null,
  ...over,
})

describe('discrepancy-auto-fix', () => {
  it('auto top-up intake when partial receipt exists', () => {
    const m = classifyIntakeGap(base({ received: 50, delivered_all: 80, warehouse_over_delivered: 30 }))
    expect(m?.disposition).toBe('auto')
  })

  it('auto backfill intake when zero received but delivered', () => {
    const m = classifyIntakeGap(base({ received: 0, delivered_all: 100, warehouse_over_delivered: 100 }))
    expect(m?.disposition).toBe('auto')
  })

  it('auto supplemental delivery for partial Spintex gap', () => {
    const m = classifyDeliveryGap(base({ delivered_palace: 50, sold_palace: 60, returned_palace: 5 }))
    expect(m?.disposition).toBe('auto')
    expect(spintexDeliveryGapQty(base({ delivered_palace: 50, sold_palace: 60, returned_palace: 5 }))).toBe(15)
  })

  it('auto delivery when zero Spintex delivery but sales exist (sales authoritative)', () => {
    const m = classifyDeliveryGap(base({ delivered_palace: 0, sold_palace: 500, returned_palace: 0 }))
    expect(m?.disposition).toBe('auto')
  })

  it('auto delivery when sold at Spintex but delivered to other Palace branch', () => {
    const row = base({
      delivered_palace: 0,
      delivered_palace_chain: 200,
      delivered_palace_other: 200,
      sold_palace: 80,
      returned_palace: 0,
    })
    const m = classifyDeliveryGap(row)
    expect(m?.disposition).toBe('auto')
    expect(m?.reviewFlag).toContain('other Palace branches')
    expect(spintexDeliveryGapQty(row)).toBe(80)
  })

  it('auto delivery even when sold ratio exceeds old admin threshold', () => {
    const m = classifyDeliveryGap(
      base({ delivered_palace: 10, sold_palace: 500, returned_palace: 0 })
    )
    expect(m?.disposition).toBe('auto')
  })

  it('admin delivery when missing barcode', () => {
    const m = classifyDeliveryGap(base({ barcode: null, delivered_palace: 0, sold_palace: 10 }))
    expect(m?.disposition).toBe('admin')
  })

  it('auto inventory when shelf too high but math is valid', () => {
    const m = classifyInventoryGap(
      base({ delivered_palace: 100, sold_palace: 60, returned_palace: 10, expected_shelf: 30, inventory_palace: 100, shelf_variance: 70 })
    )
    expect(m?.disposition).toBe('auto')
  })

  it('auto inventory when outflow exceeds Spintex deliveries (sales authoritative)', () => {
    const row = base({ delivered_palace: 50, sold_palace: 80, returned_palace: 0, shelf_variance: 20 })
    const m = classifyInventoryGap(row)
    expect(m?.disposition).toBe('auto')
    expect(impliedExpectedShelf(row)).toBe(0)
  })

  it('auto inventory when delivered but nothing sold or returned (full shelf)', () => {
    const m = classifyInventoryGap(
      base({ delivered_palace: 100, sold_palace: 0, returned_palace: 0, expected_shelf: 100, inventory_palace: 0, shelf_variance: -100 })
    )
    expect(m?.disposition).toBe('auto')
  })
})
