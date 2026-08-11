-- 026_migration_staging_info_level.sql
-- First-class INFO validation level (distinct from WARNING), e.g. "category unchanged",
-- "existing product/vendor matched" — informational events that must NOT inflate the
-- warning count or force validation_status into 'warnings'.

ALTER TABLE public.migration_staging_rows
  ADD COLUMN IF NOT EXISTS infos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.migration_staging_rows.infos IS 'INFO-level messages (e.g. category unchanged, existing product matched) — never affects validation_status';
