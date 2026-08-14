-- The 'intakes' migration template was labelled "Warehouse Receipts", which doesn't match the
-- app's own "Receiving" nav item/page (/dashboard/receiving) for the same table — admins looking
-- for a "receiving" template on the Migration Templates page couldn't find it under that name.
-- Rename to match, and clarify the description now that it can be confused with Deliveries.
UPDATE public.migration_templates
SET label = 'Receiving',
    description = 'Stock received into the DistroGH warehouse from vendors (matches the Receiving page) — upload this before Deliveries',
    updated_at = now()
WHERE entity_type = 'intakes';
