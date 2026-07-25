-- 021_historical_migration_engine.sql
-- Enterprise Historical Data Migration Engine
-- Staging + durable sessions + jobs + audit. Never writes production until approved import jobs run.

-- ─── Entity type enum (text + check for forward compatibility) ───────────────

CREATE TABLE IF NOT EXISTS public.migration_projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN (
                        'draft','analysing','awaiting_correction','ready','approved',
                        'importing','paused','verifying','completed','failed',
                        'cancelled','rolled_back','archived'
                      )),
  current_stage     INT NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 10),
  progress_pct      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  validation_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (validation_status IN ('pending','running','passed','failed','warnings')),
  rollback_available BOOLEAN NOT NULL DEFAULT false,
  wizard_state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  dependency_graph  JSONB NOT NULL DEFAULT '[]'::jsonb,
  import_order      JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconciliation    JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  warning_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  files_uploaded    INT NOT NULL DEFAULT 0,
  error_count       INT NOT NULL DEFAULT 0,
  warning_count     INT NOT NULL DEFAULT 0,
  created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_migration_projects_status ON public.migration_projects(status);
CREATE INDEX IF NOT EXISTS idx_migration_projects_created ON public.migration_projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migration_projects_activity ON public.migration_projects(last_activity_at DESC);

-- ─── Uploaded files (metadata) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  entity_type       TEXT, -- detected or user-assigned
  original_filename TEXT NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT NOT NULL DEFAULT 0,
  checksum_sha256   TEXT,
  parse_status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (parse_status IN ('pending','parsing','parsed','failed','replaced')),
  parse_error       TEXT,
  row_count         INT NOT NULL DEFAULT 0,
  sheet_names       JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_columns  JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_at       TIMESTAMPTZ,
  replaced_by_file_id UUID REFERENCES public.migration_files(id) ON DELETE SET NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_migration_files_migration ON public.migration_files(migration_id) WHERE is_active;

-- Durable blob storage (Vercel FS is ephemeral)
CREATE TABLE IF NOT EXISTS public.migration_file_blobs (
  file_id   UUID PRIMARY KEY REFERENCES public.migration_files(id) ON DELETE CASCADE,
  content   BYTEA NOT NULL
);

-- ─── Staging rows (unified) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_staging_rows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  file_id           UUID REFERENCES public.migration_files(id) ON DELETE SET NULL,
  entity_type       TEXT NOT NULL,
  row_number        INT NOT NULL,
  raw_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (validation_status IN ('pending','valid','warning','error','corrected')),
  errors            JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  corrections       JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_refs     JSONB NOT NULL DEFAULT '{}'::jsonb, -- { vendor_id, product_id, ... }
  intended_action   TEXT NOT NULL DEFAULT 'create'
                      CHECK (intended_action IN ('create','update','skip','merge_candidate')),
  production_id     UUID,
  imported_at       TIMESTAMPTZ,
  import_phase      TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (migration_id, entity_type, file_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_migration_staging_mig_entity
  ON public.migration_staging_rows(migration_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_migration_staging_status
  ON public.migration_staging_rows(migration_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_migration_staging_prod
  ON public.migration_staging_rows(migration_id, production_id)
  WHERE production_id IS NOT NULL;

-- ─── Entity mappings (smart match decisions) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_entity_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  entity_type       TEXT NOT NULL,
  source_key        TEXT NOT NULL, -- e.g. vendor name / barcode
  source_label      TEXT,
  production_id     UUID,
  decision          TEXT NOT NULL DEFAULT 'unresolved'
                      CHECK (decision IN ('unresolved','link','create','skip')),
  confidence        NUMERIC(5,2) NOT NULL DEFAULT 0,
  suggestions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  decided_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (migration_id, entity_type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_migration_mappings_mig
  ON public.migration_entity_mappings(migration_id, entity_type);

-- ─── Background jobs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  job_type          TEXT NOT NULL
                      CHECK (job_type IN (
                        'analyse','parse','validate','import','reconcile','rollback'
                      )),
  entity_type       TEXT,
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','paused','completed','failed','cancelled')),
  progress_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,
  current_record    INT NOT NULL DEFAULT 0,
  total_records     INT NOT NULL DEFAULT 0,
  chunk_size        INT NOT NULL DEFAULT 250,
  last_cursor       TEXT,
  attempt_count     INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 5,
  error_message     TEXT,
  result_summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_at         TIMESTAMPTZ,
  locked_by         TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_jobs_queue
  ON public.migration_jobs(status, created_at)
  WHERE status IN ('queued','running','paused');
CREATE INDEX IF NOT EXISTS idx_migration_jobs_mig
  ON public.migration_jobs(migration_id, created_at DESC);

-- ─── Phase results / reconciliation ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_phase_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  phase             TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  expected_count    INT NOT NULL DEFAULT 0,
  imported_count    INT NOT NULL DEFAULT 0,
  updated_count     INT NOT NULL DEFAULT 0,
  skipped_count     INT NOT NULL DEFAULT 0,
  error_count       INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','balanced','mismatch','failed','rolled_back')),
  reconciliation    JSONB NOT NULL DEFAULT '{}'::jsonb,
  production_ids    UUID[] NOT NULL DEFAULT '{}',
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  UNIQUE (migration_id, phase, entity_type)
);

-- ─── Rollback log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_rollback_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL CHECK (scope IN ('full','phase','entity')),
  phase             TEXT,
  entity_type       TEXT,
  rows_affected     INT NOT NULL DEFAULT 0,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Migration-specific audit trail ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_audit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id      UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  actor_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  stage             INT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_audit_mig
  ON public.migration_audit_events(migration_id, created_at DESC);

-- ─── Templates ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.migration_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  description       TEXT,
  required_columns  JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_columns  JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_rows       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.migration_templates (entity_type, label, description, required_columns, optional_columns, sample_rows)
VALUES
  ('categories', 'Categories', 'Product category catalogue',
   '["name"]'::jsonb, '["description"]'::jsonb,
   '[{"name":"Beverages"}]'::jsonb),
  ('vendors', 'Vendors', 'Supplier master data',
   '["name"]'::jsonb,
   '["contact_person","phone","email","momo_number","momo_network","commission_rate","status"]'::jsonb,
   '[{"name":"Acme Foods","phone":"0240000000","momo_network":"MTN"}]'::jsonb),
  ('products', 'Products', 'Vendor SKUs and pricing',
   '["name","vendor_name","vendor_price"]'::jsonb,
   '["barcode","sku","category","supermarket_selling_price","markup_amount"]'::jsonb,
   '[{"name":"Palm Oil 1L","vendor_name":"Acme Foods","vendor_price":25,"barcode":"1234567890"}]'::jsonb),
  ('supermarkets', 'Supermarkets', 'Retail outlets (chain = name)',
   '["name"]'::jsonb,
   '["branch","store_code","location","region"]'::jsonb,
   '[{"name":"Palace","branch":"Accra Mall","store_code":"PAL-001"}]'::jsonb),
  ('intakes', 'Warehouse Receipts', 'Stock received at DistroGH',
   '["vendor_name","product_name","quantity","received_date"]'::jsonb,
   '["notes","barcode"]'::jsonb,
   '[{"vendor_name":"Acme Foods","product_name":"Palm Oil 1L","quantity":100,"received_date":"2024-01-15"}]'::jsonb),
  ('deliveries', 'Deliveries', 'Delivery runs + line items',
   '["supermarket_name","product_name","quantity","delivery_date"]'::jsonb,
   '["branch","store_code","transport_cost","barcode"]'::jsonb,
   '[{"supermarket_name":"Palace","branch":"Accra Mall","product_name":"Palm Oil 1L","quantity":20,"delivery_date":"2024-01-20","transport_cost":50}]'::jsonb),
  ('sales', 'Historical Sales', 'Monthly/period sales lines (Palace / generic Excel)',
   '["product","qty"]'::jsonb,
   '["code","barcode","description","store","branch","name","vendor","TCostEx","unit_price","week_start","week_end","report_month"]'::jsonb,
   '[{"description":"Palm Oil 1L","code":"1234567890","qty":5,"TCostEx":150,"BRANCH":"Accra Mall","NAME":"Acme Foods"}]'::jsonb),
  ('returns', 'Historical Returns', 'Returned / defective items',
   '["product_name","quantity","return_date","reason"]'::jsonb,
   '["supermarket_name","branch","barcode","notes"]'::jsonb,
   '[{"product_name":"Palm Oil 1L","quantity":2,"return_date":"2024-02-01","reason":"defective_product","supermarket_name":"Palace"}]'::jsonb),
  ('deductions', 'Vendor Deductions', 'Manual / transport deductions',
   '["vendor_name","amount","deduction_date"]'::jsonb,
   '["reason","reference_type","reference_id"]'::jsonb,
   '[{"vendor_name":"Acme Foods","amount":50,"deduction_date":"2024-01-21","reason":"Transport"}]'::jsonb),
  ('payouts', 'Vendor Payouts', 'Historical MoMo payouts',
   '["vendor_name","amount_paid","payout_date"]'::jsonb,
   '["amount_due","week_start","week_end","status","transaction_id"]'::jsonb,
   '[{"vendor_name":"Acme Foods","amount_paid":1000,"amount_due":1000,"payout_date":"2024-02-05","status":"completed"}]'::jsonb),
  ('service_charges', 'Service Charges', 'Annual vendor service charge periods',
   '["vendor_name"]'::jsonb,
   '["paid_at","expires_at","years_paid"]'::jsonb,
   '[{"vendor_name":"Acme Foods","paid_at":"2024-01-01","expires_at":"2025-01-01","years_paid":1}]'::jsonb),
  ('opening_balances', 'Opening Balances', 'Pre-system vendor balances (staged; policy-controlled commit)',
   '["vendor_name","balance"]'::jsonb,
   '["as_of_date","notes"]'::jsonb,
   '[{"vendor_name":"Acme Foods","balance":2500,"as_of_date":"2024-01-01"}]'::jsonb),
  ('vendor_documents', 'Vendor Documents', 'FDA / document metadata',
   '["vendor_name"]'::jsonb,
   '["fda_certificate_acquired_date","fda_certificate_expiry_date","notes"]'::jsonb,
   '[{"vendor_name":"Acme Foods","fda_certificate_expiry_date":"2026-12-31"}]'::jsonb)
ON CONFLICT (entity_type) DO NOTHING;

-- ─── RBAC: historical_migrations module ──────────────────────────────────────

INSERT INTO public.permissions (module, action)
SELECT m.module, a.action
FROM (VALUES
  ('historical_migrations')
) AS m(module)
CROSS JOIN (VALUES
  ('read'),('create'),('update'),('delete'),('export'),('approve'),('manage')
) AS a(action)
WHERE NOT EXISTS (
  SELECT 1 FROM public.permissions p WHERE p.module = m.module AND p.action = a.action
);

-- Grant full historical_migrations to admin role template
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin'
  AND p.module = 'historical_migrations'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- Activity timestamps are updated by the application layer (touchMigration).
