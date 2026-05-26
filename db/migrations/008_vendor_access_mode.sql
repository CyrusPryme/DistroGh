-- Admin-managed vendors: no portal login; admin delivers printable reports.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'self_service'
    CHECK (access_mode IN ('self_service', 'admin_managed')),
  ADD COLUMN IF NOT EXISTS contact_person_name TEXT,
  ADD COLUMN IF NOT EXISTS report_delivery_notes TEXT;

COMMENT ON COLUMN public.vendors.access_mode IS 'self_service: vendor logs in; admin_managed: admin-operated, reports only.';
COMMENT ON COLUMN public.vendors.contact_person_name IS 'Primary contact person (especially for admin-managed vendors).';
COMMENT ON COLUMN public.vendors.report_delivery_notes IS 'How/when to deliver printed reports to the vendor.';

-- Existing vendors without login are treated as admin-managed.
UPDATE public.vendors
SET access_mode = 'admin_managed'
WHERE deleted_at IS NULL
  AND (login_email IS NULL OR trim(login_email) = '')
  AND access_mode = 'self_service';
