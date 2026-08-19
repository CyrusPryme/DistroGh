-- Historical sales: amounts derived from qty + TCostEx only; vendor comes from matched product.
UPDATE public.migration_templates
SET optional_columns = '["product_name","branch","paid","supermarket_paid","month","report_year","store","barcode","week_start","week_end"]'::jsonb,
    description = 'Historical sales (Palace-compatible). Match products by description+code; vendor is resolved from the product — do not add a vendor column. TCostEx + qty determine the per-unit price at time of recording (TCostEx ÷ qty); unit_price is not on the template. paid / supermarket_paid: Yes = supermarket settled with DistroGH.',
    sample_rows = '[{"description":"Palm Oil 1L","code":"1234567890","product_name":"Palm Oil 1L","qty":5,"store_name":"Accra Mall","branch":"Accra Mall","TCostEx":150,"report_month":"2024-06-01","paid":"","supermarket_paid":"No"}]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
