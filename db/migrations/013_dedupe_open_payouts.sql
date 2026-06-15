-- Remove duplicate open pending payouts (same vendor + week). Keep the newest; prefer any row with payments recorded.
WITH open_payouts AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY vendor_id, week_start, week_end
      ORDER BY coalesce(amount_paid, 0) DESC, created_at DESC
    ) AS rn
  FROM public.payouts
  WHERE deleted_at IS NULL
    AND status = 'pending'
    AND amount_due > coalesce(amount_paid, 0)
)
UPDATE public.payouts p
SET deleted_at = now(), updated_at = now()
FROM open_payouts o
WHERE p.id = o.id
  AND o.rn > 1;
