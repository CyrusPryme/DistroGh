-- Palace TCostEx is DistroGH's price to the supermarket (Palace's supplier cost), not vendor payout.
-- Historical Palace imports stored TCostEx as both total_sales and vendor_due with commission 0.
-- Split those rows using catalog vendor_price: vendor_due = qty × vendor_price,
-- Distro markup = TCostEx − vendor_due (capped at 0 if catalog vendor price exceeds Palace amount).

UPDATE public.sales s
SET
  vendor_due = split.vendor_due,
  commission_amount = split.commission_amount,
  updated_at = now()
FROM (
  SELECT
    s2.id,
    CASE
      WHEN ROUND((s2.qty_sold * COALESCE(p.vendor_price, 0))::numeric, 2) > s2.total_sales
        THEN s2.total_sales
      ELSE ROUND((s2.qty_sold * COALESCE(p.vendor_price, 0))::numeric, 2)
    END AS vendor_due,
    CASE
      WHEN ROUND((s2.qty_sold * COALESCE(p.vendor_price, 0))::numeric, 2) > s2.total_sales
        THEN 0::numeric
      ELSE ROUND((s2.total_sales - ROUND((s2.qty_sold * COALESCE(p.vendor_price, 0))::numeric, 2))::numeric, 2)
    END AS commission_amount
  FROM public.sales s2
  JOIN public.products p ON p.id = s2.product_id
  WHERE s2.deleted_at IS NULL
    AND s2.import_batch_id LIKE 'migration_%'
    AND COALESCE(s2.commission_amount, 0) = 0
    AND ROUND(COALESCE(s2.vendor_due, 0)::numeric, 2) = ROUND(COALESCE(s2.total_sales, 0)::numeric, 2)
) split
WHERE s.id = split.id;

UPDATE public.migration_templates
SET description = 'Historical sales (Palace-compatible). Match products by description+code; vendor is resolved from the product. TCostEx is DistroGH''s price to the supermarket (Palace supplier cost). Vendor due and Distro markup are split from catalog vendor_price + distrogh_markup. paid: Yes = supermarket settled with DistroGH.',
    updated_at = now()
WHERE entity_type = 'sales';
