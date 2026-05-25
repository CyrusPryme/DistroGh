-- Organization + labeling for a cleaner Postgres UI.
-- Keeps app tables in `public` (no breaking changes), and adds:
-- - a `reporting` schema for read-only views
-- - descriptive comments on tables/columns
-- - a few safe indexes for common lookups

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema for "containers" / reporting views
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS reporting;

COMMENT ON SCHEMA reporting IS 'Read-only reporting views for dashboards and exports. Base tables remain in public schema.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Table comments (these show up in pgAdmin/Adminer)
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.users IS 'Application login identities (local auth replacement for Supabase auth).';
COMMENT ON TABLE public.profiles IS 'Role + vendor binding for each user.';

COMMENT ON TABLE public.vendors IS 'Vendors (suppliers). Soft-deleted via deleted_at for audit/history.';
COMMENT ON COLUMN public.vendors.deleted_at IS 'Soft delete timestamp; when set, vendor should be treated as inactive but retained for audit/history.';
COMMENT ON COLUMN public.vendors.status IS 'Onboarding status: pending_verification | active | suspended.';
COMMENT ON COLUMN public.vendors.login_email IS 'Email used to log in as vendor (if provided).';
COMMENT ON COLUMN public.vendors.auth_cleanup_done_at IS 'Legacy marker: admin confirmed auth account removed from Supabase (historical).';

COMMENT ON TABLE public.products IS 'Products supplied by vendors. Soft-deleted via deleted_at.';
COMMENT ON TABLE public.sales IS 'Imported sales per week and supermarket. Soft-deleted via deleted_at.';
COMMENT ON TABLE public.payouts IS 'Vendor payouts per week. Soft-deleted via deleted_at.';
COMMENT ON TABLE public.product_returns IS 'Returns/damages recorded per product & supermarket. Soft-deleted via deleted_at.';
COMMENT ON TABLE public.vendor_deductions IS 'Manual deductions applied to a vendor (fees, penalties, adjustments).';
COMMENT ON TABLE public.intakes IS 'Stock received from vendors at DistroGH (receiving workflow). Soft-deleted via deleted_at.';
COMMENT ON TABLE public.supermarkets IS 'Supermarkets (customers). Soft-deleted via deleted_at.';

COMMENT ON TABLE public.vendor_deactivation_requests IS 'Vendor-initiated account deactivation requests requiring admin review.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Safe indexes (non-breaking, improves UI screens & joins)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_vendor_id_active
  ON public.products(vendor_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payouts_vendor_id_active
  ON public.payouts(vendor_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_week_start_active
  ON public.sales(week_start)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_product_id_active
  ON public.sales(product_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_returns_product_id_active
  ON public.product_returns(product_id)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reporting views (clean "containers" for dashboards)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW reporting.active_vendors AS
SELECT *
FROM public.vendors
WHERE deleted_at IS NULL;

COMMENT ON VIEW reporting.active_vendors IS 'Convenience view of non-deleted vendors.';

-- Vendor balances view:
-- balance = total_due - returns_deduct - total_deductions - total_paid
CREATE OR REPLACE VIEW reporting.vendor_balances AS
WITH sales_totals AS (
  SELECT
    pr.vendor_id,
    SUM(COALESCE(s.vendor_due, 0)) AS total_due
  FROM public.sales s
  JOIN public.products pr ON pr.id = s.product_id
  WHERE s.deleted_at IS NULL
    AND pr.deleted_at IS NULL
  GROUP BY pr.vendor_id
),
returns_totals AS (
  SELECT
    pr.vendor_id,
    SUM(COALESCE(r.quantity_returned, 0) * COALESCE(pr.vendor_price, 0)) AS returns_deduct
  FROM public.product_returns r
  JOIN public.products pr ON pr.id = r.product_id
  WHERE r.deleted_at IS NULL
    AND pr.deleted_at IS NULL
  GROUP BY pr.vendor_id
),
deductions_totals AS (
  SELECT
    d.vendor_id,
    SUM(COALESCE(d.amount, 0)) AS total_deductions
  FROM public.vendor_deductions d
  GROUP BY d.vendor_id
),
paid_totals AS (
  SELECT
    p.vendor_id,
    SUM(COALESCE(p.amount_paid, 0)) AS total_paid
  FROM public.payouts p
  WHERE p.deleted_at IS NULL
    AND p.status = 'completed'
  GROUP BY p.vendor_id
)
SELECT
  v.id AS vendor_id,
  v.name AS vendor_name,
  v.momo_number,
  v.momo_network,
  COALESCE(st.total_due, 0) AS total_due,
  COALESCE(pt.total_paid, 0) AS total_paid,
  (COALESCE(st.total_due, 0)
    - COALESCE(rt.returns_deduct, 0)
    - COALESCE(dt.total_deductions, 0)
    - COALESCE(pt.total_paid, 0)
  ) AS balance
FROM public.vendors v
LEFT JOIN sales_totals st ON st.vendor_id = v.id
LEFT JOIN returns_totals rt ON rt.vendor_id = v.id
LEFT JOIN deductions_totals dt ON dt.vendor_id = v.id
LEFT JOIN paid_totals pt ON pt.vendor_id = v.id
WHERE v.deleted_at IS NULL
ORDER BY balance DESC, vendor_name ASC;

COMMENT ON VIEW reporting.vendor_balances IS 'Computed balances for non-deleted vendors (due - returns - deductions - completed payouts).';

COMMIT;

