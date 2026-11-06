-- The sales template had two columns resolving to the exact same product match field: required
-- 'code' and optional 'barcode'. sales-fields.ts (pickSalesField(data, 'code', 'barcode', 'Code'))
-- already treats them as interchangeable aliases — both ended up with a live "existing product
-- barcodes" dropdown once 'code' got its own dropdown (template-xlsx.ts), which showed as two
-- visually-duplicate barcode columns in the downloaded Excel template.
--
-- Remove the redundant optional 'barcode' column. The required 'code' column covers the same
-- purpose; its Excel header is now displayed as "barcode" (see displayColumnName in
-- template-xlsx.ts) while the underlying column key stays 'code' so parsing keeps working
-- unchanged for both old and newly-downloaded templates (parse.ts reads headers literally, and
-- sales-fields.ts already accepts a 'barcode' header as an alias of 'code').
UPDATE public.migration_templates
SET optional_columns = '["product_name","branch","paid","month","report_year","store","week_start","week_end"]'::jsonb,
    updated_at = now()
WHERE entity_type = 'sales';
