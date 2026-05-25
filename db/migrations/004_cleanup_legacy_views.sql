-- Remove legacy public.vendor_balances view (incorrect formula).
-- Canonical balances live in reporting.vendor_balances (migration 003).

BEGIN;

DROP VIEW IF EXISTS public.vendor_balances;

COMMIT;
