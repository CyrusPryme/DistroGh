-- Track how each delivery run's transport cost is split across vendors (deducted from payouts).

CREATE TABLE IF NOT EXISTS public.delivery_run_vendor_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_run_id UUID NOT NULL REFERENCES public.delivery_runs(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  quantity_delivered INTEGER NOT NULL CHECK (quantity_delivered > 0),
  share_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  allocated_amount NUMERIC(12,2) NOT NULL CHECK (allocated_amount > 0),
  vendor_deduction_id UUID NOT NULL REFERENCES public.vendor_deductions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_run_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_run_vendor_charges_run
  ON public.delivery_run_vendor_charges(delivery_run_id);

CREATE INDEX IF NOT EXISTS idx_delivery_run_vendor_charges_vendor
  ON public.delivery_run_vendor_charges(vendor_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_deductions_delivery_run_vendor
  ON public.vendor_deductions (reference_id, vendor_id)
  WHERE reference_type = 'delivery_run' AND reference_id IS NOT NULL;

COMMENT ON TABLE public.delivery_run_vendor_charges IS
  'Per-vendor share of delivery_run.total_transport_cost; creates vendor_deduction on confirm.';
