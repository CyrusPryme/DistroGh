-- Returns reduce vendor balance only up to settled (supermarket_paid) sales
-- at the same product + supermarket (see lib/vendor-balance-sql.ts).

CREATE OR REPLACE VIEW reporting.vendor_balances AS
WITH settled_by_pair AS (
  SELECT
    pr.vendor_id,
    s.product_id,
    s.supermarket_id,
    SUM(COALESCE(s.vendor_due, 0)) AS settled_due
  FROM public.sales s
  JOIN public.products pr ON pr.id = s.product_id
  WHERE s.deleted_at IS NULL
    AND pr.deleted_at IS NULL
    AND s.supermarket_paid = true
  GROUP BY pr.vendor_id, s.product_id, s.supermarket_id
),
returns_by_pair AS (
  SELECT
    pr.vendor_id,
    r.product_id,
    r.supermarket_id,
    SUM(
      COALESCE(r.quantity_returned, 0)
      * COALESCE(r.unit_price, pr.vendor_price, 0)
    ) AS return_value
  FROM public.product_returns r
  JOIN public.products pr ON pr.id = r.product_id
  WHERE r.deleted_at IS NULL
    AND pr.deleted_at IS NULL
  GROUP BY pr.vendor_id, r.product_id, r.supermarket_id
),
sales_totals AS (
  SELECT vendor_id, SUM(settled_due) AS total_due
  FROM settled_by_pair
  GROUP BY vendor_id
),
returns_totals AS (
  SELECT
    rb.vendor_id,
    SUM(LEAST(rb.return_value, COALESCE(sb.settled_due, 0))) AS returns_deduct
  FROM returns_by_pair rb
  LEFT JOIN settled_by_pair sb
    ON sb.vendor_id = rb.vendor_id
    AND sb.product_id = rb.product_id
    AND sb.supermarket_id = rb.supermarket_id
  GROUP BY rb.vendor_id
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
  'Vendor balance = settled sales vendor_due − returns (capped by settled sales per product/branch) − deductions − payouts recorded (non-failed).';
