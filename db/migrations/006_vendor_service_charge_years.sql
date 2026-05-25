-- Years purchased on the most recent service charge payment (e.g. 5 = five-year advance)

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS service_charge_years_paid INTEGER
    CHECK (service_charge_years_paid IS NULL OR (service_charge_years_paid >= 1 AND service_charge_years_paid <= 20));

COMMENT ON COLUMN public.vendors.service_charge_years_paid IS 'Number of years covered by the last recorded service charge payment.';
