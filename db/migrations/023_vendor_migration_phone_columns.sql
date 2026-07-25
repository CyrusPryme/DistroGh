-- 023_vendor_migration_phone_columns.sql
-- Clarify momo_number vs contact_phone on vendor migration templates.

UPDATE public.migration_templates
SET
  description = 'Supplier master data. momo_number = MoMo wallet for payouts; contact_phone = person/business phone to reach the vendor. Always imported as admin-managed (no portal login).',
  required_columns = '["name","momo_number","momo_network"]'::jsonb,
  optional_columns = '["contact_phone","contact_person_name","commission_rate","description","report_delivery_notes","status"]'::jsonb,
  sample_rows = '[{"name":"Acme Foods","contact_person_name":"Ama Mensah","contact_phone":"0302123456","momo_number":"0244123456","momo_network":"MTN","commission_rate":10}]'::jsonb,
  updated_at = now()
WHERE entity_type = 'vendors';
