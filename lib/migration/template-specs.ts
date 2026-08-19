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
    optional_columns: ['notes', 'barcode'],
  },
  {
    entity_type: 'deliveries',
    required_columns: ['supermarket_name', 'product_name', 'quantity', 'delivery_date'],
    optional_columns: [
      'branch',
      'store_code',
      'destination_type',
      'destination_reference',
      'transport_cost',
      'barcode',
    ],
  },
  {
    entity_type: 'sales',
    required_columns: ['description', 'code', 'qty', 'store_name', 'TCostEx', 'report_month'],
    optional_columns: [
      'product_name',
      'branch',
      'paid',
      'month',
      'report_year',
      'store',
      'barcode',
      'week_start',
      'week_end',
    ],
  },
  {
    entity_type: 'returns',
    required_columns: ['product_name', 'quantity', 'return_date', 'reason'],
    optional_columns: ['supermarket_name', 'branch', 'barcode', 'notes'],
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
  | 'live_barcode'
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
  if (entityType !== 'products' && column === 'barcode') return 'live_barcode'
  if (entityType === 'products' && column === 'category') return 'live_category'

  if (
    [
      'momo_network',
      'status',
      'reason',
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
