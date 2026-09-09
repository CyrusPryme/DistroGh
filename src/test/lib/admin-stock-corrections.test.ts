/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_STOCK_CORRECTIONS,
  chainBalancedAfterCorrection,
} from '@/lib/migration/admin-stock-corrections'
import { impliedExpectedShelf } from '@/lib/migration/discrepancy-auto-fix'
import type { StockChainProductRow } from '@/lib/migration/stock-chain-data'

describe('admin stock corrections', () => {
  it('Adepa target projects balanced shelf after correction', () => {
    const spec = ADMIN_STOCK_CORRECTIONS.find((s) => s.id === 'adepa-butter-cereal-legume-flou')!
    const sold = 8
    const projected: StockChainProductRow = {
      product_id: 'x',
      barcode: spec.barcode,
      product_name: spec.product_name,
      vendor_name: spec.vendor_name,
      received: spec.received_total,
      delivered_all: spec.delivered_spintex_total,
      delivered_palace: spec.delivered_spintex_total,
      delivered_palace_chain: spec.delivered_spintex_total,
      delivered_palace_other: 0,
      sold_palace: sold,
      returned_palace: spec.returned_spintex_total,
      inventory_palace: impliedExpectedShelf({
        product_id: 'x',
        barcode: spec.barcode,
        product_name: spec.product_name,
        vendor_name: spec.vendor_name,
        received: spec.received_total,
        delivered_all: spec.delivered_spintex_total,
        delivered_palace: spec.delivered_spintex_total,
        delivered_palace_chain: spec.delivered_spintex_total,
        delivered_palace_other: 0,
        sold_palace: sold,
        returned_palace: spec.returned_spintex_total,
        inventory_palace: 0,
        expected_shelf: 0,
        shelf_variance: 0,
        warehouse_over_delivered: 0,
        earliest_intake: null,
        earliest_delivery: null,
        earliest_delivery_spintex: null,
        earliest_sale: null,
        earliest_return: null,
      }),
      expected_shelf: 0,
      shelf_variance: 0,
      warehouse_over_delivered: 0,
      earliest_intake: null,
      earliest_delivery: null,
      earliest_delivery_spintex: null,
      earliest_sale: null,
      earliest_return: null,
    }
    projected.expected_shelf = impliedExpectedShelf(projected)
    projected.shelf_variance = projected.inventory_palace - projected.expected_shelf

    expect(projected.inventory_palace).toBe(147)
    expect(chainBalancedAfterCorrection(projected)).toBe(true)
  })
})
