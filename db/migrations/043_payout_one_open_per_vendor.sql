-- One open payout per vendor (pending/processing with balance remaining).
-- Aligns with lib/payout-open.ts and prevents duplicate MoMo records across weeks.

WITH open_payouts AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY vendor_id
      ORDER BY coalesce(amount_paid, 0) DESC, created_at DESC
    ) AS rn
  FROM public.payouts
  WHERE deleted_at IS NULL
    AND status IN ('pending', 'processing')
    AND amount_due > coalesce(amount_paid, 0)
)
UPDATE public.payouts p
SET deleted_at = now(), updated_at = now()
FROM open_payouts o
WHERE p.id = o.id
  AND o.rn > 1;

DROP INDEX IF EXISTS public.payouts_one_open_per_vendor_week;

CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_open_per_vendor
  ON public.payouts (vendor_id)
  WHERE deleted_at IS NULL
    AND status IN ('pending', 'processing')
    AND amount_due > coalesce(amount_paid, 0);

COMMENT ON INDEX public.payouts_one_open_per_vendor IS
  'At most one open (pending/processing) payout with balance remaining per vendor.';
