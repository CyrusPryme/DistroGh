-- Full-system audit follow-up: close race conditions the application layer already assumes
-- are impossible but the database didn't actually enforce.

-- Vendor name uniqueness is checked app-side via lower(name), but the existing unique index
-- is case-sensitive, so "Acme" and "acme" could both exist under a race or a bypass path.
-- Replace it with an expression index matching the actual business rule.
DROP INDEX IF EXISTS idx_vendors_name_unique_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_lower_name_unique_active
ON public.vendors (lower(name))
WHERE deleted_at IS NULL;

-- Mobile money number is checked for uniqueness app-side (POST /api/vendors) but was never
-- enforced at the database level, so concurrent requests could create duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_momo_number_unique_active
ON public.vendors (momo_number)
WHERE deleted_at IS NULL AND momo_number IS NOT NULL AND momo_number != '';

-- import_batch_id is looked up on every bulk sales import to check idempotency
-- (see app/api/sales/bulk-insert/route.ts); it had no index at all and would sequential-scan
-- as the sales table grows. Not unique — one batch intentionally spans many sale rows.
CREATE INDEX IF NOT EXISTS idx_sales_import_batch_id
ON public.sales (import_batch_id)
WHERE import_batch_id IS NOT NULL;
