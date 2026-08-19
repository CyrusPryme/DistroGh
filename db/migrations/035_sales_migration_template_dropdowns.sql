-- Historical sales template: Palace-compatible columns with live dropdowns for outlets,
-- vendors, products (optional product_name), settlement flags, and legacy MONTH + report_year.
UPDATE public.migration_templates
SET required_columns = '["description","code","qty","store_name","TCostEx","report_month"]'::jsonb,
    optional_columns = '["product_name","branch","vendor","paid","supermarket_paid","month","report_year","store","barcode","unit_price","week_start","week_end"]'::jsonb,
    description = 'Historical sales (Palace-compatible). store_name/branch = supermarket outlet. description+code match existing products; optional product_name dropdown for manual rows. paid or supermarket_paid: Yes = supermarket settled with DistroGH; blank or No = awaiting payment.',
    sample_rows = '[{"description":"Palm Oil 1L","code":"1234567890","product_name":"Palm Oil 1L","qty":5,"store_name":"Accra Mall","branch":"Accra Mall","TCostEx":150,"report_month":"2024-06-01","vendor":"Acme Foods","paid":"","supermarket_paid":"No"}]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
