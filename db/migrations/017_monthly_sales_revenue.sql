-- Sales are recorded per calendar month. Aggregate revenue by month (week_start/week_end hold month bounds).
CREATE OR REPLACE VIEW public.weekly_revenue AS
SELECT
  date_trunc('month', s.week_start::timestamp)::date AS week_start,
  (date_trunc('month', s.week_start::timestamp) + interval '1 month' - interval '1 day')::date AS week_end,
  SUM(s.total_sales) AS total_sales,
  SUM(s.commission_amount) AS total_commission,
  SUM(s.vendor_due) AS total_vendor_due,
  COUNT(DISTINCT s.product_id) AS products_sold,
  COUNT(*) AS transaction_count
FROM public.sales s
WHERE s.deleted_at IS NULL
GROUP BY date_trunc('month', s.week_start::timestamp)
ORDER BY week_start DESC;

COMMENT ON VIEW public.weekly_revenue IS
  'Monthly sales totals (legacy view name). Groups sales by calendar month using week_start.';
