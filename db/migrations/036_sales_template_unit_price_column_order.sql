-- Sales template: unit_price column sits next to TCostEx (see getMigrationTemplateColumnOrder in template-xlsx.ts).
UPDATE public.migration_templates
SET optional_columns = '["unit_price","product_name","branch","vendor","paid","supermarket_paid","month","report_year","store","barcode","week_start","week_end"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
