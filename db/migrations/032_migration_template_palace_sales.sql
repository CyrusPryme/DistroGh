-- Palace-style historical sales template: aligns with TOTAL SALES exports (store/store_name,
-- Code, description, Qty, TCostEx, report_month, optional paid flag). Legacy MONTH-only rows
-- are still accepted when report_year is supplied — see lib/migration/sales-fields.ts.
UPDATE public.migration_templates
SET required_columns = '["description","code","qty","store_name","TCostEx","report_month"]'::jsonb,
    optional_columns = '["store","vendor","paid","barcode","month","report_year","unit_price","week_start","week_end"]'::jsonb,
    description = 'Palace / monthly sales lines — one row per product sold at a branch. report_month is the sales month (YYYY-MM-01). paid (Yes or blank) marks whether the vendor was already paid for that month; blank means unpaid.',
    sample_rows = '[{"store":"1020","store_name":"LABONE","code":"342787011143","description":"TROPICA WATERMELON SUGARDRAGON","qty":1,"TCostEx":35,"vendor":"Acme Foods","report_month":"2024-06-01","paid":""}]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
