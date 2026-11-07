-- 'store_name' (required) and 'branch' (optional) on the sales migration template both resolve
-- to the exact same supermarket-outlet match field (see sales-fields.ts normalizeSalesRowData(),
-- which copies the same value into both out.store_name and out.branch) and both render identical
-- live supermarket-branch dropdowns (SUPERMARKET_BRANCH_COLUMNS in template-xlsx.ts). This is the
-- same duplicate-column pattern already fixed for sales code/barcode in migration 044. 'store_name'
-- stays (it's required and already clearly labeled); the duplicate optional 'branch' column is
-- dropped.
UPDATE public.migration_templates
SET optional_columns = '["product_name","paid","month","report_year","store","week_start","week_end"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
