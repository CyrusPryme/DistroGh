-- DistroGH markup on the dashboard/reports is product.distrogh_markup × qty when
-- sales.commission_amount was stored as 0 (historical Palace imports had no markup column).
CREATE OR REPLACE VIEW public.weekly_revenue AS
SELECT
  date_trunc('month', s.week_start::timestamp)::date AS week_start,
  (date_trunc('month', s.week_start::timestamp) + interval '1 month' - interval '1 day')::date AS week_end,
  SUM(s.total_sales) AS total_sales,
  SUM(
    CASE
      WHEN COALESCE(s.commission_amount, 0) > 0 THEN s.commission_amount
      ELSE ROUND((s.qty_sold * COALESCE(p.distrogh_markup, 0))::numeric, 2)
    END
  ) AS total_commission,
  SUM(s.vendor_due) AS total_vendor_due,
  COUNT(DISTINCT s.product_id) AS products_sold,
  COUNT(*) AS transaction_count
FROM public.sales s
JOIN public.products p ON p.id = s.product_id
WHERE s.deleted_at IS NULL
GROUP BY date_trunc('month', s.week_start::timestamp)
ORDER BY week_start DESC;

COMMENT ON VIEW public.weekly_revenue IS
  'Monthly sales totals (legacy view name). Markup uses stored commission, else qty × product.distrogh_markup.';
