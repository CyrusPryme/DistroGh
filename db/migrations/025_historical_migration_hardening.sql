-- 025_historical_migration_hardening.sql
-- Hardens the Historical Data Migration Engine with first-class support for:
--   1. Historical delivery destinations that are not a supermarket branch
--      (warehouse / distribution point / unknown-historical) without fabricating branches.
--   2. Context-aware transport_cost validation (NULL allowed only for historical migration).
--   3. Product category-change provenance + rollback (never lose the previous category).
--   4. Cross-project idempotency keyed on source file checksum + sheet + row.
--   5. Financial-integrity discrepancy flags surfaced before commit.
--
-- LIVE operational rules are unchanged and are enforced additionally via CHECK constraints
-- (belt-and-braces alongside application-level validation in app/api/deliveries).

-- ─── Fix pre-existing schema drift referenced by migration writers ───────────
-- lib/migration/writers.ts inserts supermarkets.region; the column was never migrated.
ALTER TABLE public.supermarkets
  ADD COLUMN IF NOT EXISTS region TEXT;

COMMENT ON COLUMN public.supermarkets.region IS 'Optional region/area name from historical supermarket imports';

-- ─── delivery_runs: historical destination model + context-aware transport cost ──

ALTER TABLE public.delivery_runs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'LIVE_OPERATION',
  ADD COLUMN IF NOT EXISTS destination_type TEXT NOT NULL DEFAULT 'BRANCH',
  ADD COLUMN IF NOT EXISTS destination_reference TEXT,
  ADD COLUMN IF NOT EXISTS migration_id UUID REFERENCES public.migration_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_file_id UUID REFERENCES public.migration_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_sheet TEXT,
  ADD COLUMN IF NOT EXISTS source_row_number INT,
  ADD COLUMN IF NOT EXISTS migrated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.delivery_runs.source IS 'LIVE_OPERATION (strict) or HISTORICAL_MIGRATION (flexible) — drives validation context';
COMMENT ON COLUMN public.delivery_runs.destination_type IS 'BRANCH | WAREHOUSE | DISTRIBUTION_POINT | UNKNOWN_HISTORICAL';
COMMENT ON COLUMN public.delivery_runs.destination_reference IS 'Free-text warehouse/distribution destination name for historical deliveries with no branch-level record; never a fabricated branch';

-- Transport cost: drop the "always defaults to 0" behaviour. NULL now means
-- "not recorded" for historical rows; live rows are protected by the CHECK below.
ALTER TABLE public.delivery_runs
  ALTER COLUMN total_transport_cost DROP NOT NULL,
  ALTER COLUMN total_transport_cost DROP DEFAULT;

-- Branch destination is not a mandatory unique business destination for historical
-- deliveries redistributed from a central warehouse — allow a nullable supermarket_id
-- specifically when the destination is not a BRANCH and the row is historical.
ALTER TABLE public.delivery_runs
  ALTER COLUMN supermarket_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_source_check'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_source_check
      CHECK (source IN ('LIVE_OPERATION', 'HISTORICAL_MIGRATION'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_destination_type_check'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_destination_type_check
      CHECK (destination_type IN ('BRANCH', 'WAREHOUSE', 'DISTRIBUTION_POINT', 'UNKNOWN_HISTORICAL'));
  END IF;

  -- A BRANCH destination must always resolve to a real supermarket row (no fake branches).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_branch_requires_supermarket'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_branch_requires_supermarket
      CHECK (destination_type <> 'BRANCH' OR supermarket_id IS NOT NULL);
  END IF;

  -- Non-BRANCH destinations (warehouse/distribution/unknown) only ever come from
  -- historical migration — never from live operational delivery creation.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_nonbranch_is_historical'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_nonbranch_is_historical
      CHECK (destination_type = 'BRANCH' OR source = 'HISTORICAL_MIGRATION');
  END IF;

  -- A non-BRANCH historical destination must still be identifiable by something
  -- (a matched supermarket OR a free-text warehouse/distribution reference).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_nonbranch_requires_reference'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_nonbranch_requires_reference
      CHECK (
        destination_type = 'BRANCH'
        OR supermarket_id IS NOT NULL
        OR destination_reference IS NOT NULL
      );
  END IF;

  -- LIVE deliveries must always target a real branch (supermarket) — never relaxed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_live_is_branch'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_live_is_branch
      CHECK (source = 'HISTORICAL_MIGRATION' OR destination_type = 'BRANCH');
  END IF;

  -- LIVE deliveries must always have a transport cost — historical rows may be NULL.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_runs_live_requires_transport_cost'
  ) THEN
    ALTER TABLE public.delivery_runs
      ADD CONSTRAINT delivery_runs_live_requires_transport_cost
      CHECK (source = 'HISTORICAL_MIGRATION' OR total_transport_cost IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_runs_source ON public.delivery_runs(source);
CREATE INDEX IF NOT EXISTS idx_delivery_runs_migration ON public.delivery_runs(migration_id) WHERE migration_id IS NOT NULL;

-- ─── Product category change provenance (auditable, reversible) ─────────────

CREATE TABLE IF NOT EXISTS public.migration_category_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id       UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  staging_row_id     UUID REFERENCES public.migration_staging_rows(id) ON DELETE SET NULL,
  previous_category  TEXT,
  new_category       TEXT,
  outcome            TEXT NOT NULL CHECK (outcome IN ('populated', 'overridden', 'unchanged', 'new_category_created')),
  source_file_id     UUID REFERENCES public.migration_files(id) ON DELETE SET NULL,
  source_sheet       TEXT,
  source_row_number  INT,
  changed_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_migration_category_changes_migration
  ON public.migration_category_changes(migration_id);
CREATE INDEX IF NOT EXISTS idx_migration_category_changes_product
  ON public.migration_category_changes(product_id, changed_at DESC);

-- ─── Cross-project idempotency (file checksum + sheet + row → production id) ─

CREATE TABLE IF NOT EXISTS public.migration_provenance (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type           TEXT NOT NULL,
  production_id         UUID,
  migration_id          UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  source_file_checksum  TEXT NOT NULL,
  source_sheet          TEXT NOT NULL DEFAULT '',
  source_row_number     INT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, source_file_checksum, source_sheet, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_migration_provenance_migration ON public.migration_provenance(migration_id);
CREATE INDEX IF NOT EXISTS idx_migration_provenance_production ON public.migration_provenance(production_id) WHERE production_id IS NOT NULL;

-- ─── Financial integrity discrepancy flags (surfaced in preview before commit) ──

CREATE TABLE IF NOT EXISTS public.migration_financial_discrepancies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id    UUID NOT NULL REFERENCES public.migration_projects(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  category        TEXT NOT NULL,
  expected_value  NUMERIC(14,2),
  actual_value    NUMERIC(14,2),
  difference      NUMERIC(14,2),
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity        TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_financial_discrepancies_migration
  ON public.migration_financial_discrepancies(migration_id);

-- ─── Delivery template: document the historical destination columns ─────────

UPDATE public.migration_templates
SET optional_columns = '["branch","store_code","destination_type","destination_reference","transport_cost","barcode"]'::jsonb,
    description = 'Delivery runs + line items. Branch/store_code optional for historical deliveries redistributed from a central warehouse — use destination_type + destination_reference instead of fabricating a branch.',
    updated_at = now()
WHERE entity_type = 'deliveries';
