-- Products created before vendor_price was maintained may have selling_price + markup only.

UPDATE public.products
SET
  vendor_price = ROUND((selling_price - COALESCE(distrogh_markup, 0))::numeric, 2),
  updated_at = now()
WHERE deleted_at IS NULL
  AND COALESCE(vendor_price, 0) = 0
  AND selling_price > COALESCE(distrogh_markup, 0);
