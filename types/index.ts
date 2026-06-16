export type MomoNetwork = 'MTN' | 'Vodafone' | 'AirtelTigo'
export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type SaleImportStatus = 'preview' | 'imported' | 'failed'
export type ReturnReason = 'expired' | 'defective_product' | 'defective_packaging' | 'other'

// ─── Core Database Models ───────────────────────────────────────────────────

export type VendorStatus = 'pending_verification' | 'active' | 'suspended'
export type VendorAccessMode = 'self_service' | 'admin_managed'
export type VendorSuspendedReason = 'manual' | 'service_charge'
export type ServiceChargePaymentStatus = 'unpaid' | 'paid'
export type ServiceChargeLifecycle =
  | 'unpaid'
  | 'active'
  | 'expiring_soon'
  | 'grace_period'
  | 'overdue'

export interface Vendor {
  id: string
  name: string
  momo_number: string
  momo_network: MomoNetwork
  default_commission: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** After migration: pending_verification | active | suspended */
  status?: VendorStatus
  /** System-generated login password; admin-only; clear after first login if desired */
  initial_password?: string | null
  /** Auth email for this vendor */
  login_email?: string | null
  /** @deprecated Legacy local path; new uploads use Google Drive */
  fda_certificate_path?: string | null
  /** Date the FDA certificate was issued/acquired */
  fda_certificate_acquired_at?: string | null
  facility_expiry_date?: string | null
  /** Google Drive file id for the FDA certificate */
  fda_drive_file_id?: string | null
  /** Google Drive webViewLink */
  fda_drive_view_link?: string | null
  /** When the certificate was last uploaded to Drive */
  fda_uploaded_at?: string | null
  verified_at?: string | null
  verified_by?: string | null
  /** Admin message when requesting changes to FDA/facility docs; vendor sees on login */
  verification_feedback?: string | null
  /** When admin removed this vendor's auth user from Supabase (manual cleanup) */
  auth_cleanup_done_at?: string | null
  /** Primary contact phone (vendor can update) */
  contact_phone?: string | null
  /** Business description (vendor can update) */
  description?: string | null
  /** When the current annual service charge was paid */
  service_charge_paid_at?: string | null
  /** Last day of paid annual service (inclusive) */
  service_charge_expires_at?: string | null
  /** Years covered by the last payment (e.g. 5 for five years in advance) */
  service_charge_years_paid?: number | null
  service_charge_reminder_sent_at?: string | null
  service_charge_grace_notified_at?: string | null
  /** Set when status is suspended */
  suspended_reason?: VendorSuspendedReason | null
  /** Portal login vs admin-managed (reports only) */
  access_mode?: VendorAccessMode
  /** Contact person name (especially admin-managed vendors) */
  contact_person_name?: string | null
  /** Notes for delivering printed reports */
  report_delivery_notes?: string | null
}

export interface Product {
  id: string
  name: string
  vendor_id: string
  selling_price: number
  commission_percent?: number
  /** Negotiated price per unit (vendor receives this). */
  vendor_price: number
  /** DistroGH fixed markup per unit. */
  distrogh_markup: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** Product expiry date (optional). */
  expiry_date?: string | null
  /** Stock keeping unit */
  sku?: string | null
  /** Optional barcode for scanner */
  barcode?: string | null
  /** Product category */
  category?: string | null
  /** Packaging size e.g. 400g, 1L */
  packaging_size?: string | null
  /** Wholesale price per unit (GHS) */
  wholesale_price?: number | null
  /** Optional public shelf price at partner supermarkets (GHS); manually entered. */
  supermarket_selling_price?: number | null
  /** Minimum order quantity */
  moq?: number | null
  /** Storage paths for product images */
  product_image_paths?: string[] | null
  // Joined
  vendor?: Vendor
}

export interface Supermarket {
  id: string
  name: string
  location: string
  /** Outlet branch when the retailer has multiple locations (e.g. ADENTA) */
  branch?: string | null
  /** Store code from retailer sales exports (e.g. 1050) */
  store_code?: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Sale {
  id: string
  product_id: string
  supermarket_id: string
  qty_sold: number
  unit_price: number
  total_sales: number
  commission_amount: number
  vendor_due: number
  week_start: string
  week_end: string
  imported_at: string
  import_batch_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  // Joined
  product?: Product
  supermarket?: Supermarket
}

export interface Payout {
  id: string
  vendor_id: string
  amount_due: number
  amount_paid: number
  momo_txn_id: string | null
  status: PayoutStatus
  payout_date: string | null
  week_start: string
  week_end: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  // Joined
  vendor?: Vendor
}

export interface ProductReturn {
  id: string
  product_id: string
  supermarket_id: string
  quantity_returned: number
  unit_price: number
  reason: ReturnReason
  reason_notes: string | null
  return_date: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  // Joined
  product?: Product
  supermarket?: Supermarket
}

/** Stock received at DistroGH from vendor (confirm & verify before sending to supermarkets) */
export interface Intake {
  id: string
  vendor_id: string
  product_id: string
  quantity_received: number
  received_date: string
  reference: string | null
  created_at: string
  deleted_at: string | null
  product?: Product
  vendor?: Vendor
}

/** Per-vendor share of a delivery run transport cost (deducted from payout balance) */
export interface DeliveryRunVendorCharge {
  vendor_id: string
  vendor_name: string
  quantity_delivered: number
  share_percent: number
  allocated_amount: number
  vendor_deduction_id?: string
}

/** Delivery run from DistroGH to supermarket; total_transport_cost is the delivery cost for this run */
export interface DeliveryRun {
  id: string
  supermarket_id: string
  delivery_date: string
  total_transport_cost: number
  notes: string | null
  created_at: string
  deleted_at: string | null
  confirmed_at: string | null
  confirmed_by: string | null
  supermarket?: Supermarket
  items?: DeliveryRunItem[]
  vendor_charges?: DeliveryRunVendorCharge[]
}

/** Current stock at a supermarket (per product); updated on delivery confirm and sales import */
export interface SupermarketInventory {
  id: string
  supermarket_id: string
  product_id: string
  quantity: number
  updated_at: string
  supermarket?: Supermarket
  product?: Product
}

/** Product line on a delivery run; transport cost is allocated from run total by quantity share */
export interface DeliveryRunItem {
  id: string
  delivery_run_id: string
  product_id: string
  quantity_delivered: number
  created_at: string
  product?: Product
}

// ─── Supabase Database Type Map ──────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      vendors: {
        Row: Vendor
        Insert: Omit<Vendor, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Vendor, 'id' | 'created_at' | 'updated_at'>>
      }
      products: {
        Row: Product
        Insert: Omit<Product, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Product, 'id' | 'created_at' | 'updated_at'>>
      }
      supermarkets: {
        Row: Supermarket
        Insert: Omit<Supermarket, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Supermarket, 'id' | 'created_at' | 'updated_at'>>
      }
      sales: {
        Row: Sale
        Insert: Omit<Sale, 'id' | 'imported_at' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Sale, 'id' | 'imported_at' | 'created_at' | 'updated_at'>>
      }
      payouts: {
        Row: Payout
        Insert: Omit<Payout, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Payout, 'id' | 'created_at' | 'updated_at'>>
      }
      vendor_applications: {
        Row: VendorApplication
        Insert: Omit<VendorApplication, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<VendorApplication, 'id' | 'created_at' | 'updated_at'>>
      }
    }
  }
}

// ─── Form Schemas / DTOs ─────────────────────────────────────────────────────

export interface VendorFormData {
  name: string
  momo_number: string
  momo_network: MomoNetwork
  /** Optional; pricing/markup is set per product. DB default 0. */
  default_commission?: number
}

export interface ProductFormData {
  name: string
  vendor_id: string
  vendor_price: number
  distrogh_markup: number
  expiry_date?: string | null
  sku?: string | null
  barcode?: string | null
  category?: string | null
  packaging_size?: string | null
  wholesale_price?: number | null
  supermarket_selling_price?: number | null
  moq?: number | null
  product_image_paths?: string[] | null
}

export interface PayoutFormData {
  vendor_id: string
  amount_paid: number
  momo_txn_id: string
  week_start: string
  week_end: string
}

// ─── Excel Import Types ───────────────────────────────────────────────────────

export interface ExcelSaleRow {
  product_name: string
  qty: number
  price: number
}

export interface ParsedSaleRow {
  product_name: string
  qty_sold: number
  unit_price: number
  total_sales: number
  commission_amount: number
  vendor_due: number
  product_id: string | null
  vendor_id: string | null
  commission_percent: number
  matched: boolean
  error?: string
  /** Palace / supermarket export: product code (barcode) */
  product_code?: string | null
  /** Creditor name from spreadsheet (vendor) */
  spreadsheet_vendor_name?: string | null
  spreadsheet_creditor?: string | null
  vendor_matched?: boolean
  vendor_error?: string
  /** Spreadsheet BRANCH column */
  branch?: string | null
  /** Spreadsheet store column */
  store_code?: string | null
  /** Resolved supermarket for this row (Palace / multi-branch imports) */
  import_supermarket_id?: string | null
  supermarket_matched?: boolean
  supermarket_error?: string
  /** TCostEx (line total) from spreadsheet */
  sheet_line_total?: number | null
  /** TCostEx ÷ Qty — supermarket unit price from spreadsheet */
  sheet_unit_price?: number | null
  /** Catalog shop price (vendor + markup) at import time */
  catalog_shop_price?: number | null
  /** Sheet unit differs from catalog shop price; sale imports at sheet price */
  price_mismatch?: boolean
  price_note?: string
  price_warning?: string
  price_error?: string
  /** User-selected product when spreadsheet name/code does not auto-match */
  manual_product_id?: string | null
  /** Database product name after match or manual link */
  matched_product_name?: string | null
  product_link_source?: 'manual' | 'auto' | null
}

export interface ImportPreview {
  rows: ParsedSaleRow[]
  unmatched: string[]
  /** Branch names from spreadsheet not found in supermarkets module */
  unmatched_branches?: string[]
  /** Matched rows where spreadsheet unit price differs from catalog shop price */
  price_mismatch_count?: number
  /** When true, each row is matched to a supermarket by branch (no single dropdown) */
  uses_branch_matching?: boolean
  totalSales: number
  totalCommission: number
  totalVendorDue: number
  rowCount: number
}

// ─── Dashboard / Report Types ─────────────────────────────────────────────────

export interface DashboardKPIs {
  totalSales: number
  totalCommission: number
  totalVendorDue: number
  vendorCount: number
  productCount: number
  pendingPayouts: number
}

export interface VendorBalance {
  vendor_id: string
  vendor_name: string
  momo_number: string
  momo_network: MomoNetwork
  total_due: number
  total_paid: number
  balance: number
}

export interface WeeklyRevenue {
  week_start: string
  week_end?: string
  total_sales: number
  total_commission: number
  total_vendor_due: number
}

export interface ProductPerformance {
  product_id: string
  product_name: string
  vendor_name: string
  total_qty: number
  total_sales: number
}

export interface VendorSalesBreakdown {
  vendor_id: string
  vendor_name: string
  total_sales: number
  total_commission: number
  total_vendor_due: number
}

export interface VendorDeduction {
  id: string
  vendor_id: string
  amount: number
  reason: string
  deduction_date: string
  reference_id?: string | null
  reference_type?: string | null
  created_at: string
  created_by?: string | null
}

export interface VendorApplication {
  id: string
  store_name: string
  contact_email: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  updated_at: string
  approved_at: string | null
  approved_by: string | null
  vendor_id: string | null
}
