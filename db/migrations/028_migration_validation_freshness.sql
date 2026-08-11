-- 028_migration_validation_freshness.sql
-- Root-cause fix for a discovered "phantom success" bug: parsing a file always deletes and
-- re-inserts staging rows (resetting validation_status back to 'pending'), but nothing tracked
-- whether a migration had been re-parsed *after* its last successful validation. That let a
-- migration reach Approve / Start Import on stale, unvalidated data — Start Import silently
-- enqueued zero import jobs, and Reconcile treated "0 expected / 0 imported" as "balanced",
-- marking the whole migration "completed" despite importing nothing.
--
-- These columns are plain timestamptz (not part of the free-form wizard_state JSON, which gets
-- wholesale-replaced by several call sites and can't be trusted to retain history), so freshness
-- can be checked reliably: block Approve/Start Import whenever last_parsed_at > last_validated_at.

ALTER TABLE public.migration_projects
  ADD COLUMN IF NOT EXISTS last_parsed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ;
