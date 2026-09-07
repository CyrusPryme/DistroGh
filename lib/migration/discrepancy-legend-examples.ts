import type { MigrationReviewLegendExample } from '@/lib/migration/fix-workbook'

/** Shared upload reminder appended to delivery/intake after examples. */
const UPLOAD_NOTE =
  'Delete columns fix_status and review_flag. Upload via Historical Migrations → parse → validate → import.'

export const DISCREPANCY_SUMMARY_LEGEND_EXAMPLES: MigrationReviewLegendExample[] = [
  {
    title: '1. AUTO row (no fill)',
    before:
      'fix_status=AUTO | quantity=30 | review_flag=AUTO — safe fix…\n→ Import from *-READY.xlsx or run-discrepancy-fix-import.ts',
    after: 'Same migration columns only (no fix_status / review_flag).',
  },
  {
    title: '2. Spintex sales authoritative',
    before:
      'Spintex sold 100 units but delivered_spintex=0 — delivery record missing, not sales wrong.',
    after:
      'AUTO: add 100-unit Spintex delivery dated before first sale. Palace-other-branch deliveries shown in delivered_palace_other for context only.',
  },
  {
    title: '3. Red blocker',
    before: 'Missing barcode on product.',
    after: 'Fix catalog first, regenerate, then import.',
  },
]

export const INTAKE_GAPS_LEGEND_EXAMPLES: MigrationReviewLegendExample[] = [
  {
    title: 'Red — missing barcode',
    before:
      'fix_status=ADMIN REVIEW | vendor_name=Vendor A | quantity=120 | barcode=(empty) | review_flag=BLOCKED…',
    after: 'Fix barcode in Catalog → Products, regenerate workbook.',
  },
  {
    title: 'AUTO backfill (no fill)',
    before:
      'fix_status=AUTO | quantity=120 | notes=received=0 delivered=120 | review_flag=AUTO — Backfill from delivery record…',
    after:
      'vendor_name | product_name | quantity | received_date | barcode\n→ Import via *-READY.xlsx or run-discrepancy-fix-import.ts',
  },
]

export const DELIVERY_GAPS_LEGEND_EXAMPLES: MigrationReviewLegendExample[] = [
  {
    title: 'AUTO — sold at Spintex, no Spintex delivery (no fill)',
    before:
      'fix_status=AUTO | quantity=110 | sold_spintex=100 | returned_spintex=10 | delivered_spintex=0 | review_flag=AUTO — sales authoritative…',
    after:
      'PALACE | product | quantity=110 | delivery_date=(before first sale) | branch=SPINTEX | barcode=…\nSales are authoritative — add missing Spintex delivery record.\n' +
      UPLOAD_NOTE,
  },
  {
    title: 'AUTO — internal Palace transfer',
    before:
      'fix_status=AUTO | sold_spintex=80 | delivered_spintex=0 | delivered_palace_other=200 | review_flag=…other Palace branches (internal transfer)…',
    after:
      'Still add 80 Spintex delivery units — stock may have entered via another Palace branch; Spintex sales still need a Spintex delivery row.\n' +
      UPLOAD_NOTE,
  },
  {
    title: 'Red — missing barcode',
    before: 'fix_status=ADMIN REVIEW | barcode=(empty) | review_flag=BLOCKED — Missing barcode…',
    after: 'Fix barcode in Catalog → Products, regenerate workbook, then import.',
  },
]

export const INVENTORY_LEGEND_EXAMPLES: MigrationReviewLegendExample[] = [
  {
    title: 'AUTO — shelf stock from deliveries (no fill)',
    before:
      'fix_status=AUTO | delivered_spintex=100 | sold_spintex=0 | implied_expected_shelf=100 | current_inventory=0',
    after:
      'Inventory set to delivered − sold − returns. Unsold delivered stock stays on the Spintex shelf.',
  },
  {
    title: 'AUTO — after sales-authoritative delivery backfill',
    before:
      'fix_status=AUTO | delivered_spintex=50 | sold_spintex=80 | implied_expected_shelf=0 | current_inventory=50',
    after:
      'After DELIVERY-GAPS adds 30 Spintex delivery units, inventory set to 0 (all sold).',
  },
  {
    title: 'Palace-other context column',
    before: 'delivered_palace_other=200 | delivered_spintex=0 | sold_spintex=80',
    after:
      'Context only — shows stock may have arrived at another Palace branch. Spintex delivery + inventory still reconciled from Spintex sales.',
  },
]

export const CHRONOLOGY_LEGEND_EXAMPLES: MigrationReviewLegendExample[] = [
  {
    title: 'Sale before delivery (AUTO)',
    before:
      'fix_status=AUTO | issue_type=SALE_BEFORE_DELIVERY | fix_action=Resolved by supplemental Spintex delivery…',
    after:
      'Import matching row from DELIVERY-GAPS-READY.xlsx — do not upload CHRONOLOGY-FIX.xlsx.',
  },
  {
    title: 'Delivery before intake (AUTO)',
    before: 'fix_status=AUTO | issue_type=DELIVERY_BEFORE_INTAKE',
    after: 'Handled by INTAKE-GAPS auto backfill dated before delivery.',
  },
]
