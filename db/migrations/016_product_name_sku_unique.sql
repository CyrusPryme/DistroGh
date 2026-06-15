-- Remove duplicate active products (same name + SKU). Keep row with most sales, else newest.
WITH ranked AS (
  SELECT
    p.id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(p.name)), coalesce(nullif(trim(p.sku), ''), '')
      ORDER BY
        (
          SELECT count(*)::int
          FROM public.sales s
          WHERE s.product_id = p.id
            AND s.deleted_at IS NULL
        ) DESC,
        p.created_at DESC
    ) AS rn
  FROM public.products p
  WHERE p.deleted_at IS NULL
)
UPDATE public.products p
SET deleted_at = now(), updated_at = now()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS products_name_sku_unique_active
  ON public.products (
    lower(trim(name)),
    coalesce(nullif(trim(sku), ''), '')
  )
  WHERE deleted_at IS NULL;
