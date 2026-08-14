-- Sales are always reported/reconciled by full calendar month in this system, so a migrated sales
-- row with no resolvable period date used to silently import dated "today" (see lib/migration/
-- writers.ts before this fix). validate.ts now hard-blocks that at the Corrections stage, but the
-- template's own required_columns still listed week_start as optional — fix the documentation to
-- match what validation actually enforces (week_start, or report_month as a documented alternative).
UPDATE public.migration_templates
SET required_columns = '["product","qty","week_start"]'::jsonb,
    optional_columns = '["code","barcode","description","store","branch","name","vendor","TCostEx","unit_price","week_end","report_month"]'::jsonb,
    description = 'Monthly/period sales lines (Palace / generic Excel) — week_start (or report_month) is required; sales are always recorded and reconciled by full calendar month',
    sample_rows = '[{"description":"Palm Oil 1L","code":"1234567890","qty":5,"TCostEx":150,"BRANCH":"Accra Mall","NAME":"Acme Foods","week_start":"2024-01-01"}]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
