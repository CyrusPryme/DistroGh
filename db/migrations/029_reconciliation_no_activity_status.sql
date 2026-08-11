-- 029_reconciliation_no_activity_status.sql
-- Same bug class as the historical-migration "phantom success" fix: a reconciliation period
-- with zero sales activity produces expected ≈ 0 and actual ≈ 0, so `variance ≈ 0` reads as
-- "balanced" — indistinguishable from a real, checked, healthy period. Add a distinct status so
-- an empty period is reported honestly instead of implying a real check passed.

ALTER TABLE public.reconciliation_runs DROP CONSTRAINT IF EXISTS reconciliation_runs_status_check;
ALTER TABLE public.reconciliation_runs ADD CONSTRAINT reconciliation_runs_status_check
  CHECK (status IN ('balanced', 'warning', 'mismatch', 'pending', 'no_activity'));
