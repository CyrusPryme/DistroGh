-- Single settlement column on the sales template: paid (Palace PAID / Yes|No).
UPDATE public.migration_templates
SET optional_columns = '["product_name","branch","paid","month","report_year","store","barcode","week_start","week_end"]'::jsonb,
    description = 'Historical sales (Palace-compatible). Match products by description+code; vendor from product. TCostEx + qty set price at recording. paid: Yes or PAID = supermarket settled with DistroGH; blank or No = awaiting payment.',
    sample_rows = '[{"description":"Palm Oil 1L","code":"1234567890","product_name":"Palm Oil 1L","qty":5,"store_name":"Accra Mall","branch":"Accra Mall","TCostEx":150,"report_month":"2024-06-01","paid":"No"}]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
