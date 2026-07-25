-- 022_migration_vendors_admin_managed.sql
-- Document that historical migration vendor templates are admin-managed only.

UPDATE public.migration_templates
SET
  description = 'Supplier master data. Always imported as admin-managed (no portal login; reports only).',
  optional_columns = '["contact_person_name","phone","contact_phone","momo_number","momo_network","commission_rate","status","description","report_delivery_notes"]'::jsonb,
  sample_rows = '[{"name":"Acme Foods","contact_person_name":"Ama Mensah","phone":"0240000000","momo_network":"MTN"}]'::jsonb,
  updated_at = now()
WHERE entity_type = 'vendors';
