-- One open pending payout per vendor + week (prevents duplicate rows from repeated clicks).
CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_open_per_vendor_week
  ON public.payouts (vendor_id, week_start, week_end)
  WHERE deleted_at IS NULL
    AND status = 'pending'
    AND amount_due > coalesce(amount_paid, 0);
