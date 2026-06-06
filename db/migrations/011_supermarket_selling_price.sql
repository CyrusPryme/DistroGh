-- Public shelf price at partner supermarkets (optional, manually entered).
-- Renames legacy mall_retail_price to a clearer name; same nullable numeric column.
ALTER TABLE public.products
  RENAME COLUMN mall_retail_price TO supermarket_selling_price;

COMMENT ON COLUMN public.products.supermarket_selling_price IS
  'Optional unit price supermarkets charge the public. Manually entered; does not affect vendor due, commission, or sales import amounts.';
