-- Replace barcode/code-based product lookups with product_name across migration templates, for
-- ease of reading/data entry (product names are easier to verify by eye than a digit string).
--
-- sales: 'code' was the required Palace-style product identifier (displayed as "barcode" via
-- displayColumnName in template-xlsx.ts — now removed, see that file). Promote the already-present
-- optional 'product_name' column to required (it already carried a live product dropdown) and drop
-- 'code' entirely. The sample row's now-unused 'code'/'branch' keys are cleaned up too ('branch'
-- was already orphaned by migration 045).
--
-- intakes/deliveries/returns: drop the optional 'barcode' column — 'product_name' is already
-- required on all three and already carries the same live product dropdown, so 'barcode' was a
-- redundant, harder-to-read second way to identify the same product.
--
-- products: deliberately UNCHANGED. Its 'barcode' column captures a *new* product's own barcode
-- value (data entry for a catalog record being created), not a lookup/match against an existing
-- product — there's nothing to "replace" with product_name there since 'name' is already a
-- separate required field.
--
-- validate.ts's product-matching logic (productByBarcode.get(barcode) || productByName.get(pname))
-- and the per-entity "missing product" checks were not changed — they already treat product_name
-- as a sufficient identifier independent of barcode/code, so removing these template columns is
-- safe without further code changes. A user who manually adds a 'barcode'/'code' header to their
-- upload (parsing is header-text-driven, not restricted to the template's own column list) still
-- gets it honored as a fallback match.
UPDATE public.migration_templates
SET required_columns = '["description","product_name","qty","store_name","TCostEx","report_month"]'::jsonb,
    optional_columns = '["paid","month","report_year","store","week_start","week_end"]'::jsonb,
    sample_rows = '[{"qty":5,"paid":"No","TCostEx":150,"store_name":"Accra Mall","description":"Palm Oil 1L","product_name":"Palm Oil 1L","report_month":"2024-06-01"}]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';

UPDATE public.migration_templates
SET optional_columns = '["notes"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'intakes';

UPDATE public.migration_templates
SET optional_columns = '["branch","store_code","destination_type","destination_reference","transport_cost"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'deliveries';

UPDATE public.migration_templates
SET optional_columns = '["supermarket_name","branch","notes"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'returns';
