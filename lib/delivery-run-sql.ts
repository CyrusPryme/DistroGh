/** Shared SQL fragment for delivery run list/detail queries */
export const DELIVERY_RUN_VENDOR_CHARGES_JSON = `
  coalesce(
    (
      select json_agg(
        json_build_object(
          'vendor_id', c.vendor_id,
          'vendor_name', v.name,
          'quantity_delivered', c.quantity_delivered,
          'share_percent', c.share_percent,
          'allocated_amount', c.allocated_amount,
          'vendor_deduction_id', c.vendor_deduction_id
        )
        order by c.allocated_amount desc
      )
      from public.delivery_run_vendor_charges c
      join public.vendors v on v.id = c.vendor_id
      where c.delivery_run_id = dr.id
    ),
    '[]'::json
  ) as vendor_charges
`

/** Lighter list query — defers vendor_charges until detail/confirm. */
export const DELIVERY_RUN_LIST_SELECT = `
  dr.*,
  json_build_object('id', sm.id, 'name', sm.name, 'location', sm.location, 'branch', sm.branch, 'store_code', sm.store_code) as supermarket,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'id', dri.id,
          'product_id', dri.product_id,
          'quantity_delivered', dri.quantity_delivered,
          'created_at', dri.created_at,
          'product', json_build_object('id', p.id, 'name', p.name, 'vendor_id', p.vendor_id)
        )
      )
      from public.delivery_run_items dri
      join public.products p on p.id = dri.product_id
      where dri.delivery_run_id = dr.id
    ),
    '[]'::json
  ) as items,
  '[]'::json as vendor_charges
`

export const DELIVERY_RUN_SELECT = `
  dr.*,
  json_build_object('id', sm.id, 'name', sm.name, 'location', sm.location, 'branch', sm.branch, 'store_code', sm.store_code) as supermarket,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'id', dri.id,
          'product_id', dri.product_id,
          'quantity_delivered', dri.quantity_delivered,
          'created_at', dri.created_at,
          'product', json_build_object('id', p.id, 'name', p.name, 'vendor_id', p.vendor_id)
        )
      )
      from public.delivery_run_items dri
      join public.products p on p.id = dri.product_id
      where dri.delivery_run_id = dr.id
    ),
    '[]'::json
  ) as items,
  ${DELIVERY_RUN_VENDOR_CHARGES_JSON}
`
