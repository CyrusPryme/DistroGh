-- Hide soft-deleted vendors from the admin vendors list while keeping DB + audit history.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS list_cleared_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vendors.list_cleared_at IS
  'When set, this deleted vendor is hidden from the vendors list. Row is retained for audit logs.';

CREATE INDEX IF NOT EXISTS idx_vendors_list_visible
  ON public.vendors (deleted_at, list_cleared_at)
  WHERE list_cleared_at IS NULL;
