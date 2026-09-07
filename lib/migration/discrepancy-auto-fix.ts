/**
 * Classify stock-chain discrepancies into safe auto-fixes vs admin review.
 *
 * Business rules (Palace Spintex):
 * - Sales are authoritative — sold at Spintex implies stock was there; missing delivery = overlooked record.
 * - Palace may deliver to one branch and sell at another (internal transfer) — do not compare Spintex sales
 *   only to Spintex deliveries when Palace chain deliveries exist elsewhere.
 * - Unsold delivered stock remains on the supermarket shelf: inventory = delivered − sold − returns.
 */
import { buildReviewFlag } from '@/lib/migration/fix-workbook'
import type { MigrationReviewHighlightKind } from '@/lib/migration/fix-workbook'
import { dateDaysBefore, type StockChainProductRow } from '@/lib/migration/stock-chain-data'

export type FixDisposition = 'auto' | 'admin'

export interface DiscrepancyRowMeta {
  disposition: FixDisposition
  kind?: MigrationReviewHighlightKind
  reviewFlag: string
}

export function spintexOutflow(p: StockChainProductRow): number {
  return p.sold_palace + p.returned_palace
}

/** Spintex supplemental delivery qty: sales/returns minus Spintex-recorded deliveries. */
export function spintexDeliveryGapQty(p: StockChainProductRow): number {
  return Math.max(0, spintexOutflow(p) - p.delivered_palace)
}

/**
 * Expected shelf after sales-authoritative Spintex delivery backfill
 * (implies missing Spintex delivery rows are added to match sold+returned).
 */
export function impliedExpectedShelf(p: StockChainProductRow): number {
  const outflow = spintexOutflow(p)
  const impliedDelivered = Math.max(p.delivered_palace, outflow)
  return Math.max(0, impliedDelivered - p.sold_palace - p.returned_palace)
}

export function intakeDateForProduct(p: StockChainProductRow): string {
  if (p.earliest_delivery) return dateDaysBefore(p.earliest_delivery, 30)
  if (p.earliest_sale) return dateDaysBefore(p.earliest_sale, 60)
  return '2025-01-01'
}

export function deliveryDateForProduct(p: StockChainProductRow): string {
  if (p.earliest_sale) return dateDaysBefore(p.earliest_sale, 30)
  if (p.earliest_return) return dateDaysBefore(p.earliest_return, 30)
  if (p.earliest_delivery_spintex) return dateDaysBefore(p.earliest_delivery_spintex, -7)
  if (p.earliest_intake) return dateDaysBefore(p.earliest_intake, -7)
  return '2025-01-01'
}

function metaForAdmin(kind: MigrationReviewHighlightKind, prefix: string, detail: string): DiscrepancyRowMeta {
  return {
    disposition: 'admin',
    kind,
    reviewFlag: buildReviewFlag(prefix, detail),
  }
}

function metaForAuto(detail: string): DiscrepancyRowMeta {
  return {
    disposition: 'auto',
    reviewFlag: buildReviewFlag('AUTO', detail),
  }
}

function palaceChainNote(p: StockChainProductRow): string {
  if (p.delivered_palace_other <= 0) return ''
  return `; ${p.delivered_palace_other} units delivered to other Palace branches (internal transfer — Spintex delivery record still missing)`
}

export function classifyIntakeGap(p: StockChainProductRow): DiscrepancyRowMeta | null {
  if (p.warehouse_over_delivered <= 0) return null

  if (!p.barcode || !p.vendor_name) {
    return metaForAdmin(
      'red',
      'BLOCKED',
      'Missing barcode or vendor — fix catalog before importing intake'
    )
  }

  if (p.received === 0) {
    return metaForAuto(
      `Backfill ${p.warehouse_over_delivered} units from delivery record (received=0, delivered ${p.delivered_all}) dated ${intakeDateForProduct(p)}`
    )
  }

  return metaForAuto(
    `Top-up ${p.warehouse_over_delivered} units (received ${p.received}, delivered ${p.delivered_all}) dated ${intakeDateForProduct(p)}`
  )
}

export function classifyDeliveryGap(p: StockChainProductRow): DiscrepancyRowMeta | null {
  const outflow = spintexOutflow(p)
  if (outflow === 0) return null

  const gap = spintexDeliveryGapQty(p)
  if (gap === 0) return null

  if (!p.barcode) {
    return metaForAdmin('red', 'BLOCKED', 'Missing barcode — cannot import delivery')
  }

  const chainNote = palaceChainNote(p)

  if (p.sold_palace > 0) {
    return metaForAuto(
      `Add ${gap} Spintex delivery units (sales authoritative: sold ${p.sold_palace} + returned ${p.returned_palace}, Spintex delivered ${p.delivered_palace}, Palace chain ${p.delivered_palace_chain})${chainNote} dated ${deliveryDateForProduct(p)}`
    )
  }

  return metaForAuto(
    `Add ${gap} Spintex delivery units (returns ${p.returned_palace} at Spintex, no Spintex delivery on record)${chainNote} dated ${deliveryDateForProduct(p)}`
  )
}

export function classifyInventoryGap(p: StockChainProductRow): DiscrepancyRowMeta | null {
  const implied = impliedExpectedShelf(p)
  const variance = p.inventory_palace - implied
  if (variance === 0) return null

  const chainNote =
    p.delivered_palace_other > 0 && spintexDeliveryGapQty(p) > 0
      ? ` (${p.delivered_palace_other} units on other Palace branches — shelf reconciled after Spintex delivery backfill)`
      : ''

  return metaForAuto(
    `Set inventory ${p.inventory_palace} → ${implied} (after sales-authoritative delivery backfill; unsold stock stays on shelf)${chainNote}`
  )
}

export type ChronologyIssue = {
  issue_type: string
  product_name: string
  barcode: string
  record_entity: string
  current_date: string
  reference_date: string
  suggested_date: string
  fix_action: string
  meta: DiscrepancyRowMeta
}

export function buildChronologyIssues(
  products: StockChainProductRow[],
  autoDeliveryBarcodes: Set<string>
): ChronologyIssue[] {
  const issues: ChronologyIssue[] = []

  for (const p of products) {
    if (
      p.earliest_intake &&
      p.earliest_delivery &&
      p.earliest_delivery < p.earliest_intake
    ) {
      const backdatedIntake = dateDaysBefore(p.earliest_delivery, 14)
      issues.push({
        issue_type: 'DELIVERY_BEFORE_INTAKE',
        product_name: p.product_name,
        barcode: p.barcode ?? '',
        record_entity: 'intakes / deliveries',
        current_date: p.earliest_delivery,
        reference_date: p.earliest_intake,
        suggested_date: backdatedIntake,
        fix_action:
          p.received > 0 || p.delivered_all > 0
            ? 'Add top-up intake dated before delivery (see INTAKE auto rows) OR confirm delivery date'
            : 'Add warehouse intake before delivery date — admin must confirm',
        meta:
          p.received > 0 || p.delivered_all > 0
            ? metaForAuto(`Backdate supplemental intake to ${backdatedIntake} (delivery ${p.earliest_delivery} before intake ${p.earliest_intake})`)
            : metaForAdmin(
                'amber',
                'ADMIN — FIX DATE',
                `Delivery ${p.earliest_delivery} before intake ${p.earliest_intake} with no prior receipt`
              ),
      })
    }

    const spintexDelivery = p.earliest_delivery_spintex ?? p.earliest_delivery
    if (
      spintexDelivery &&
      p.earliest_sale &&
      p.earliest_sale < spintexDelivery &&
      p.sold_palace > 0
    ) {
      const bc = p.barcode ?? ''
      if (autoDeliveryBarcodes.has(bc)) {
        issues.push({
          issue_type: 'SALE_BEFORE_DELIVERY',
          product_name: p.product_name,
          barcode: bc,
          record_entity: 'sales / deliveries',
          current_date: p.earliest_sale,
          reference_date: spintexDelivery,
          suggested_date: deliveryDateForProduct(p),
          fix_action: 'Resolved by supplemental Spintex delivery in DELIVERY-GAPS auto rows (sales authoritative)',
          meta: metaForAuto(
            `Sale ${p.earliest_sale} before Spintex delivery ${spintexDelivery} — covered by auto supplemental delivery dated ${deliveryDateForProduct(p)}`
          ),
        })
      } else {
        issues.push({
          issue_type: 'SALE_BEFORE_DELIVERY',
          product_name: p.product_name,
          barcode: bc,
          record_entity: 'sales / deliveries',
          current_date: p.earliest_sale,
          reference_date: spintexDelivery,
          suggested_date: deliveryDateForProduct(p),
          fix_action: 'Fix missing barcode or import DELIVERY-GAPS auto row for this product',
          meta: metaForAdmin(
            'amber',
            'ADMIN — CHRONOLOGY',
            `Sale ${p.earliest_sale} before Spintex delivery ${spintexDelivery} — blocked on catalog; resolve barcode then re-import delivery`
          ),
        })
      }
    }
  }

  return issues
}

export function buildIntakeFixRows(products: StockChainProductRow[]) {
  const rows: Record<string, unknown>[] = []
  const meta: DiscrepancyRowMeta[] = []

  for (const p of products) {
    const m = classifyIntakeGap(p)
    if (!m) continue
    rows.push({
      fix_status: m.disposition === 'auto' ? 'AUTO' : 'ADMIN REVIEW',
      vendor_name: p.vendor_name ?? '',
      product_name: p.product_name,
      quantity: p.warehouse_over_delivered,
      received_date: intakeDateForProduct(p),
      barcode: p.barcode ?? '',
      notes: `received=${p.received} delivered=${p.delivered_all}`,
    })
    meta.push(m)
  }

  return sortAutoFirst(rows, meta)
}

export function buildDeliveryFixRows(products: StockChainProductRow[]) {
  const rows: Record<string, unknown>[] = []
  const meta: DiscrepancyRowMeta[] = []
  const autoBarcodes = new Set<string>()

  for (const p of products) {
    const m = classifyDeliveryGap(p)
    if (!m) continue
    const qty = spintexDeliveryGapQty(p)
    if (m.disposition === 'auto' && p.barcode) autoBarcodes.add(p.barcode)

    rows.push({
      fix_status: m.disposition === 'auto' ? 'AUTO' : 'ADMIN REVIEW',
      supermarket_name: 'PALACE',
      product_name: p.product_name,
      quantity: qty,
      delivery_date: deliveryDateForProduct(p),
      branch: 'SPINTEX',
      store_code: '1004',
      barcode: p.barcode ?? '',
      sold_spintex: p.sold_palace,
      returned_spintex: p.returned_palace,
      delivered_spintex: p.delivered_palace,
      delivered_palace_other: p.delivered_palace_other,
    })
    meta.push(m)
  }

  return { ...sortAutoFirst(rows, meta), autoBarcodes }
}

export function buildInventoryFixRows(products: StockChainProductRow[]) {
  const rows: Record<string, unknown>[] = []
  const meta: DiscrepancyRowMeta[] = []

  for (const p of products) {
    const m = classifyInventoryGap(p)
    if (!m) continue
    const implied = impliedExpectedShelf(p)
    rows.push({
      fix_status: m.disposition === 'auto' ? 'AUTO' : 'ADMIN REVIEW',
      product_name: p.product_name,
      barcode: p.barcode ?? '',
      delivered_spintex: p.delivered_palace,
      delivered_palace_other: p.delivered_palace_other,
      sold_spintex: p.sold_palace,
      returned_spintex: p.returned_palace,
      expected_shelf: p.expected_shelf,
      implied_expected_shelf: implied,
      current_inventory: p.inventory_palace,
      suggested_inventory: implied,
      adjustment_qty: implied - p.inventory_palace,
    })
    meta.push(m)
  }

  return sortAutoFirst(rows, meta)
}

function sortAutoFirst(
  rows: Record<string, unknown>[],
  meta: DiscrepancyRowMeta[]
): { rows: Record<string, unknown>[]; meta: DiscrepancyRowMeta[] } {
  const combined = rows.map((row, i) => ({ row, meta: meta[i]! }))
  combined.sort((a, b) => {
    if (a.meta.disposition === b.meta.disposition) return 0
    return a.meta.disposition === 'auto' ? -1 : 1
  })
  return {
    rows: combined.map((c) => c.row),
    meta: combined.map((c) => c.meta),
  }
}

export function countByDisposition(meta: DiscrepancyRowMeta[]) {
  return {
    auto: meta.filter((m) => m.disposition === 'auto').length,
    admin: meta.filter((m) => m.disposition === 'admin').length,
  }
}
