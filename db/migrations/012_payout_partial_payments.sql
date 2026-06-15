-- Manual MoMo payouts: count amount_paid toward vendor balance as soon as admin records it
-- (pending partial payments reduce balance; failed payouts are excluded).

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
  'Vendor balance = sales due − returns − deductions − recorded payouts (including partial pending).';
