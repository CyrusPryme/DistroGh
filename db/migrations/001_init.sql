-- Local Postgres schema (Supabase-free).
-- This is a consolidated baseline schema derived from `supabase/migrations.sql`
-- plus subsequent feature migrations, with Supabase-specific RLS/auth/storage removed.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Auth replacement (minimal) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles keep the app's role + optional vendor binding.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'vendor')),
  vendor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Core tables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  momo_number TEXT NOT NULL,
  momo_network TEXT NOT NULL CHECK (momo_network IN ('MTN', 'Vodafone', 'AirtelTigo')),
  default_commission NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,

  -- onboarding / verification
  status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'active', 'suspended')),
  initial_password TEXT,
  login_email TEXT,
  fda_certificate_path TEXT,
  facility_expiry_date DATE,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.users(id),
  verification_feedback TEXT,
  auth_cleanup_done_at TIMESTAMPTZ,
  contact_phone TEXT,
  description TEXT
);

-- link profiles.vendor_id after vendors exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'profiles'
      AND constraint_name = 'profiles_vendor_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name_unique_active
ON public.vendors (name)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendors_status ON public.vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_verified_at ON public.vendors(verified_at);

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  selling_price NUMERIC(12,2) NOT NULL,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  vendor_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  distrogh_markup NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  expiry_date DATE,
  sku TEXT,
  barcode TEXT,
  category TEXT,
  packaging_size TEXT,
  wholesale_price NUMERIC(12,2),
  mall_retail_price NUMERIC(12,2),
  moq INTEGER,
  product_image_paths TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_products_vendor_id ON public.products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_expiry_date ON public.products(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.supermarkets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supermarket_id UUID NOT NULL REFERENCES public.supermarkets(id) ON DELETE RESTRICT,
  qty_sold INTEGER NOT NULL CHECK (qty_sold > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  total_sales NUMERIC(14,2) NOT NULL,
  commission_amount NUMERIC(14,2) NOT NULL,
  vendor_due NUMERIC(14,2) NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_batch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_product_id ON public.sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_supermarket_id ON public.sales(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_sales_week_start ON public.sales(week_start);

CREATE TABLE IF NOT EXISTS public.payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  amount_due NUMERIC(14,2) NOT NULL,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  momo_txn_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payout_date TIMESTAMPTZ,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_vendor_id ON public.payouts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON public.payouts(status);

CREATE TABLE IF NOT EXISTS public.vendor_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_name TEXT NOT NULL,
  contact_email TEXT NOT NULL UNIQUE,
  contact_phone TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.users(id),
  vendor_id UUID REFERENCES public.vendors(id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_applications_status ON public.vendor_applications(status);
CREATE INDEX IF NOT EXISTS idx_vendor_applications_email ON public.vendor_applications(contact_email);

-- ─── Deductions / returns ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vendor_deductions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL,
  deduction_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  reference_id UUID,
  reference_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_deductions_vendor_id ON public.vendor_deductions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_deductions_deduction_date ON public.vendor_deductions(deduction_date DESC);

CREATE TABLE IF NOT EXISTS public.product_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supermarket_id UUID NOT NULL REFERENCES public.supermarkets(id) ON DELETE RESTRICT,
  quantity_returned INTEGER NOT NULL CHECK (quantity_returned > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('expired', 'defective_product', 'defective_packaging', 'other')),
  reason_notes TEXT,
  return_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_product_returns_product_id ON public.product_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_product_returns_supermarket_id ON public.product_returns(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_product_returns_return_date ON public.product_returns(return_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_returns_reason ON public.product_returns(reason);

-- ─── Receiving / deliveries / inventory ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intakes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  received_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_intakes_vendor_id ON public.intakes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_intakes_product_id ON public.intakes(product_id);
CREATE INDEX IF NOT EXISTS idx_intakes_received_date ON public.intakes(received_date DESC);

CREATE TABLE IF NOT EXISTS public.delivery_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supermarket_id UUID NOT NULL REFERENCES public.supermarkets(id) ON DELETE RESTRICT,
  delivery_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  total_transport_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_transport_cost >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_runs_supermarket_id ON public.delivery_runs(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_delivery_date ON public.delivery_runs(delivery_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_confirmed_at ON public.delivery_runs(confirmed_at) WHERE confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.delivery_run_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_run_id UUID NOT NULL REFERENCES public.delivery_runs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity_delivered INTEGER NOT NULL CHECK (quantity_delivered > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(delivery_run_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_run_items_run_id ON public.delivery_run_items(delivery_run_id);
CREATE INDEX IF NOT EXISTS idx_delivery_run_items_product_id ON public.delivery_run_items(product_id);

CREATE TABLE IF NOT EXISTS public.supermarket_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supermarket_id UUID NOT NULL REFERENCES public.supermarkets(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supermarket_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_supermarket_inventory_supermarket ON public.supermarket_inventory(supermarket_id);
CREATE INDEX IF NOT EXISTS idx_supermarket_inventory_product ON public.supermarket_inventory(product_id);

-- ─── Settings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_unique ON public.categories (LOWER(name));

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Views ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.vendor_balances AS
SELECT
  v.id AS vendor_id,
  v.name AS vendor_name,
  v.momo_number,
  v.momo_network,
  COALESCE(SUM(s.vendor_due), 0) - COALESCE(SUM(d.amount), 0) AS total_due,
  COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount_paid ELSE 0 END), 0) AS total_paid,
  COALESCE(SUM(s.vendor_due), 0) - COALESCE(SUM(d.amount), 0) - COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount_paid ELSE 0 END), 0) AS balance
FROM public.vendors v
LEFT JOIN public.products pr ON pr.vendor_id = v.id AND pr.deleted_at IS NULL
LEFT JOIN public.sales s ON s.product_id = pr.id AND s.deleted_at IS NULL
LEFT JOIN (SELECT vendor_id, SUM(amount) AS amount FROM public.vendor_deductions GROUP BY vendor_id) d ON d.vendor_id = v.id
LEFT JOIN public.payouts p ON p.vendor_id = v.id AND p.deleted_at IS NULL
GROUP BY v.id, v.name, v.momo_number, v.momo_network;

CREATE OR REPLACE VIEW public.weekly_revenue AS
SELECT
  week_start,
  week_end,
  SUM(total_sales) AS total_sales,
  SUM(commission_amount) AS total_commission,
  SUM(vendor_due) AS total_vendor_due,
  COUNT(DISTINCT product_id) AS products_sold,
  COUNT(*) AS transaction_count
FROM public.sales
GROUP BY week_start, week_end
ORDER BY week_start DESC;

-- ─── Seed supermarkets (idempotent) ──────────────────────────────────────────
INSERT INTO public.supermarkets (name, location)
VALUES
  ('Accra Mall Shoprite', 'Accra, Greater Accra'),
  ('West Hills Mall', 'Weija, Greater Accra'),
  ('Marina Mall', 'Airport City, Accra'),
  ('Kumasi City Mall', 'Kumasi, Ashanti'),
  ('Palace Mall', 'East Legon, Accra')
ON CONFLICT DO NOTHING;
