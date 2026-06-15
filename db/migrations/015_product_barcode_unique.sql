-- Resolve duplicate active barcodes, then enforce uniqueness (empty barcode allowed on many products).
WITH ranked AS (
  SELECT
    p.id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(p.barcode))
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
    AND p.barcode IS NOT NULL
    AND trim(p.barcode) <> ''
)
UPDATE public.products p
SET barcode = NULL, updated_at = now()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique_active
  ON public.products (lower(trim(barcode)))
  WHERE deleted_at IS NULL
    AND barcode IS NOT NULL
    AND trim(barcode) <> '';
