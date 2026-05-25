-- Annual vendor platform service charge (paid / expiry / reminders / grace suspension)

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS service_charge_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_charge_expires_at DATE,
  ADD COLUMN IF NOT EXISTS service_charge_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_charge_grace_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT
    CHECK (suspended_reason IS NULL OR suspended_reason IN ('manual', 'service_charge'));

COMMENT ON COLUMN public.vendors.service_charge_paid_at IS 'When the current annual service period was paid.';
COMMENT ON COLUMN public.vendors.service_charge_expires_at IS 'Last day of the paid annual service period (inclusive).';
COMMENT ON COLUMN public.vendors.service_charge_reminder_sent_at IS 'When the 30-day renewal reminder was shown/recorded.';
COMMENT ON COLUMN public.vendors.service_charge_grace_notified_at IS 'When the 14-day post-expiry grace warning was shown/recorded.';
COMMENT ON COLUMN public.vendors.suspended_reason IS 'Why suspended: manual (admin) or service_charge (unpaid after grace).';

CREATE INDEX IF NOT EXISTS idx_vendors_service_charge_expires
  ON public.vendors (service_charge_expires_at)
  WHERE deleted_at IS NULL AND service_charge_expires_at IS NOT NULL;
