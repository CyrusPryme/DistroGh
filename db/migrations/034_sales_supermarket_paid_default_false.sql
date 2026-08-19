-- New sales imports (no PAID column on Palace reports) start as awaiting supermarket settlement.
-- DistroGH marks lines settled on the Sales page after receiving payment from the supermarket.
ALTER TABLE public.sales
  ALTER COLUMN supermarket_paid SET DEFAULT false;

COMMENT ON COLUMN public.sales.supermarket_paid IS
  'True when the supermarket has remitted payment to DistroGH for this sale line. Updated by DistroGH after import (or from PAID column when present). Vendor balance uses settled lines only.';
