-- PAID on Palace supermarket reports = that sale line was settled by the supermarket to DistroGH
-- (not vendor MoMo payout). Vendor balance only counts vendor_due once supermarket_paid is true.
-- Existing sales default to true so live imports without a PAID column keep prior behaviour.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS supermarket_paid BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sales.supermarket_paid IS
  'True when the supermarket has remitted payment to DistroGH for this sale line (Palace PAID column). Vendor balance uses only supermarket_paid sales.';

CREATE OR REPLACE VIEW reporting.vendor_balances AS
WITH sales_totals AS (
  SELECT
    pr.vendor_id,
    SUM(COALESCE(s.vendor_due, 0)) AS total_due
  FROM public.sales s
  JOIN public.products pr ON pr.id = s.product_id
  WHERE s.deleted_at IS NULL
    AND pr.deleted_at IS NULL
    AND s.supermarket_paid = true
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
    AND p.status <> 'failed'
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

COMMENT ON VIEW reporting.vendor_balances IS
  'Vendor balance = vendor_due from supermarket-settled sales only − returns − deductions − payouts recorded.';

UPDATE public.migration_templates
SET description = 'Palace / monthly sales lines — one row per product sold at a branch. PAID (if present) = supermarket has paid DistroGH for that line; blank = sold but not yet settled. Vendor balance counts only settled lines.',
    optional_columns = '["store","vendor","paid","barcode","month","report_year","unit_price","week_start","week_end","supermarket_paid"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
