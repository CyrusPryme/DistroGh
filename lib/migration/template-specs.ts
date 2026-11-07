/**
 * Canonical migration template columns (mirrors latest db/migrations/* template updates).
 * Used by tests to ensure every reference column gets the correct Excel dropdown/validation.
 */
export type TemplateColumnSpec = {
  entity_type: string
  required_columns: string[]
  optional_columns: string[]
}

export const CANONICAL_MIGRATION_TEMPLATE_SPECS: TemplateColumnSpec[] = [
  {
    entity_type: 'categories',
    required_columns: ['name'],
    optional_columns: ['description'],
  },
  {
    entity_type: 'vendors',
    required_columns: ['name', 'momo_number', 'momo_network'],
    optional_columns: [
      'contact_phone',
      'contact_person_name',
      'commission_rate',
      'description',
      'report_delivery_notes',
      'status',
    ],
  },
  {
    entity_type: 'products',
    required_columns: ['name', 'vendor_name', 'vendor_price'],
    // 'barcode' here captures the new product's own barcode value (data entry), unlike the
    // 'barcode'/'code' lookup columns removed from intakes/deliveries/returns/sales (db/migrations/
    // 046_*) — there's nothing to "replace" with product_name since 'name' is already a separate
    // required field and this isn't a reference match against an existing product.
    optional_columns: ['barcode', 'sku', 'category', 'supermarket_selling_price', 'markup_amount'],
  },
  {
    entity_type: 'supermarkets',
    required_columns: ['name'],
    optional_columns: ['branch', 'store_code', 'location', 'region'],
  },
  {
    entity_type: 'intakes',
    required_columns: ['vendor_name', 'product_name', 'quantity', 'received_date'],
    // 'barcode' was removed as a separate optional column (db/migrations/046_*) — 'product_name'
    // is already required and gets a live, human-readable product dropdown, so a secondary
    // barcode lookup was a redundant, harder-to-read way to identify the same product.
    optional_columns: ['notes'],
  },
  {
    entity_type: 'deliveries',
    required_columns: ['supermarket_name', 'product_name', 'quantity', 'delivery_date'],
    // 'barcode' removed (db/migrations/046_*) — same reasoning as intakes above.
    optional_columns: ['branch', 'store_code', 'destination_type', 'destination_reference', 'transport_cost'],
  },
  {
    entity_type: 'sales',
    // 'code' (the required Palace-style product identifier, displayed as "barcode") was replaced
    // by promoting 'product_name' to required (db/migrations/046_*) — product names are easier to
    // read/verify by eye than a digit string, and 'product_name' already carried a live dropdown
    // as an optional column before this change. Mirrors the *latest* db/migrations/0NN_sales_*.sql
    // update to migration_templates — several migrations touched this row (035-038, 044, 045, 046).
    // Always verify against the live `migration_templates` DB row, not just the newest-numbered
    // file, since later migrations can supersede earlier ones' column lists.
    required_columns: ['description', 'product_name', 'qty', 'store_name', 'TCostEx', 'report_month'],
    optional_columns: ['paid', 'month', 'report_year', 'store', 'week_start', 'week_end'],
  },
  {
    entity_type: 'returns',
    required_columns: ['product_name', 'quantity', 'return_date', 'reason'],
    // 'barcode' removed (db/migrations/046_*) — same reasoning as intakes above.
    optional_columns: ['supermarket_name', 'branch', 'notes'],
  },
  {
    entity_type: 'deductions',
    required_columns: ['vendor_name', 'amount', 'deduction_date'],
    optional_columns: ['reason', 'reference_type', 'reference_id'],
  },
  {
    entity_type: 'payouts',
    required_columns: ['vendor_name', 'amount_paid', 'payout_date'],
    optional_columns: ['amount_due', 'week_start', 'week_end', 'status', 'transaction_id'],
  },
  {
    entity_type: 'service_charges',
    required_columns: ['vendor_name'],
    optional_columns: ['paid_at', 'expires_at', 'years_paid'],
  },
  {
    entity_type: 'opening_balances',
    required_columns: ['vendor_name', 'balance'],
    optional_columns: ['as_of_date', 'notes'],
  },
  {
    entity_type: 'vendor_documents',
    required_columns: ['vendor_name'],
    optional_columns: ['fda_certificate_acquired_date', 'fda_certificate_expiry_date', 'notes'],
  },
]

export type DropdownExpectation =
  | 'live_vendor'
  | 'live_product'
  | 'live_supermarket_chain'
  | 'live_supermarket_branch'
  | 'live_category'
  | 'static_list'
  | 'date'
  | 'phone'
  | 'decimal'
  | 'whole'
  | 'none'

/** Expected validation/dropdown behaviour per column — keep in sync with template-xlsx.ts. */
export function expectedDropdownExpectation(entityType: string, column: string): DropdownExpectation {
  if (entityType === 'supermarkets' || entityType === 'supermarket_chains') {
    if (['name', 'branch', 'store_code'].includes(column)) return 'none'
  }
  if (entityType === 'products' && column === 'name') return 'none'
  if (entityType === 'categories' && column === 'name') return 'none'

  if (column === 'vendor_name' || column === 'vendor') return 'live_vendor'
  if (column === 'supermarket_name') return 'live_supermarket_chain'
  if (column === 'store_name' || column === 'branch') return 'live_supermarket_branch'
  if (entityType !== 'products' && (column === 'product_name' || column === 'product')) return 'live_product'
  if (entityType === 'products' && column === 'category') return 'live_category'

  // 'reason' is only a static dropdown on the returns template (product-return enum). Other
  // entities with a 'reason' column (e.g. deductions) are free text in the live app — see
  // ENTITY_FIELD_OVERRIDES.returns / the FIELD_VALIDATIONS note in template-xlsx.ts.
  if (entityType === 'returns' && column === 'reason') return 'static_list'
  if (column === 'reason') return 'none'

  if (
    [
      'momo_network',
      'status',
      'paid',
      'month',
      'destination_type',
    ].includes(column)
  ) {
    return 'static_list'
  }

  if (
    [
      'received_date',
      'delivery_date',
      'return_date',
      'deduction_date',
      'payout_date',
      'as_of_date',
      'paid_at',
      'expires_at',
      'week_start',
      'week_end',
      'report_month',
      'fda_certificate_acquired_date',
      'fda_certificate_expiry_date',
    ].includes(column)
  ) {
    return 'date'
  }

  if (['momo_number', 'contact_phone', 'phone'].includes(column)) return 'phone'
  if (['quantity', 'qty', 'years_paid', 'report_year'].includes(column)) return 'whole'
  if (
    [
      'vendor_price',
      'amount',
      'amount_paid',
      'amount_due',
      'balance',
      'commission_rate',
      'transport_cost',
      'TCostEx',
      'tcostex',
      'markup_amount',
      'supermarket_selling_price',
      'unit_price',
    ].includes(column)
  ) {
    return 'decimal'
  }

  return 'none'
}
