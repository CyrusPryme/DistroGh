import type { Pool } from 'pg'

export type VendorActivityRow = {
  vendor_id: string
  vendor_name: string
  received: number
  delivered: number
  sold: number
  returns: number
  /** All-time warehouse stock (received − delivered), not limited by period. Never negative (see warehouse_gap). */
  warehouse_on_hand: number
  /**
   * All-time signed net (sum of received − delivered across this vendor's products). Can be negative.
   * A negative or zero value here can still hide an over-delivered SKU offset by an under-delivered one —
   * always check has_over_delivered_product / the per-product breakdown before trusting this at face value.
   */
  warehouse_gap: number
  /** True if at least one product for this vendor has been delivered more than it was ever received (all-time). */
  has_over_delivered_product: boolean
}

export type VendorActivityProductRow = {
  product_id: string
  product_name: string
  received: number
  delivered: number
  sold: number
  returns: number
  /** All-time warehouse stock (received − delivered), clamped at 0 for display as a physical quantity. */
  warehouse_on_hand: number
  /** All-time signed gap (received − delivered). Negative means this SKU has been delivered more than received. */
  warehouse_gap: number
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseVendorIdList(raw: string | null): string[] {
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (!id || !UUID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Period metrics use received_date, delivery_date, sales week overlap, and return_date.
 * Warehouse on-hand is always all-time (matches receiving stock API semantics).
 */
export async function fetchVendorActivityRows(
  pool: Pool,
  vendorIds: string[],
  rangeStart: string | null,
  rangeEnd: string | null,
  soldSupermarketPaidOnly: boolean
): Promise<VendorActivityRow[]> {
  if (vendorIds.length === 0) return []

  const { rows } = await pool.query(
    `
    with target as (
      select unnest($1::uuid[]) as vendor_id
    ),
    received as (
      select p.vendor_id, coalesce(sum(i.quantity_received), 0)::int as units
      from public.intakes i
      join public.products p on p.id = i.product_id
      where i.deleted_at is null
        and p.deleted_at is null
        and p.vendor_id = any($1::uuid[])
        and ($2::date is null or i.received_date >= $2::date)
        and ($3::date is null or i.received_date <= $3::date)
      group by p.vendor_id
    ),
    delivered as (
      select p.vendor_id, coalesce(sum(dri.quantity_delivered), 0)::int as units
      from public.delivery_run_items dri
      join public.delivery_runs dr on dr.id = dri.delivery_run_id
      join public.products p on p.id = dri.product_id
      where dr.deleted_at is null
        and p.deleted_at is null
        and p.vendor_id = any($1::uuid[])
        and ($2::date is null or dr.delivery_date >= $2::date)
        and ($3::date is null or dr.delivery_date <= $3::date)
      group by p.vendor_id
    ),
    sold as (
      select p.vendor_id, coalesce(sum(s.qty_sold), 0)::int as units
      from public.sales s
      join public.products p on p.id = s.product_id
      where s.deleted_at is null
        and p.deleted_at is null
        and p.vendor_id = any($1::uuid[])
        and ($2::date is null or s.week_end >= $2::date)
        and ($3::date is null or s.week_start <= $3::date)
        and ($4::boolean is false or s.supermarket_paid = true)
      group by p.vendor_id
    ),
    returns as (
      select p.vendor_id, coalesce(sum(r.quantity_returned), 0)::int as units
      from public.product_returns r
      join public.products p on p.id = r.product_id
      where r.deleted_at is null
        and p.deleted_at is null
        and p.vendor_id = any($1::uuid[])
        and ($2::date is null or r.return_date >= $2::date)
        and ($3::date is null or r.return_date <= $3::date)
      group by p.vendor_id
    ),
    recv_all as (
      select i.product_id, sum(i.quantity_received)::int as received
      from public.intakes i
      where i.deleted_at is null
      group by i.product_id
    ),
    deliv_all as (
      select dri.product_id, sum(dri.quantity_delivered)::int as delivered
      from public.delivery_run_items dri
      join public.delivery_runs dr on dr.id = dri.delivery_run_id
      where dr.deleted_at is null
      group by dri.product_id
    ),
    warehouse as (
      select
        p.vendor_id,
        coalesce(
          sum(greatest(0, coalesce(ra.received, 0) - coalesce(da.delivered, 0))),
          0
        )::int as warehouse_on_hand,
        coalesce(
          sum(coalesce(ra.received, 0) - coalesce(da.delivered, 0)),
          0
        )::int as warehouse_gap,
        bool_or(coalesce(da.delivered, 0) > coalesce(ra.received, 0)) as has_over_delivered_product
      from public.products p
      left join recv_all ra on ra.product_id = p.id
      left join deliv_all da on da.product_id = p.id
      where p.deleted_at is null
        and p.vendor_id = any($1::uuid[])
      group by p.vendor_id
    )
    select
      v.id as vendor_id,
      v.name as vendor_name,
      coalesce(rc.units, 0) as received,
      coalesce(dv.units, 0) as delivered,
      coalesce(sl.units, 0) as sold,
      coalesce(rt.units, 0) as returns,
      coalesce(wh.warehouse_on_hand, 0) as warehouse_on_hand,
      coalesce(wh.warehouse_gap, 0) as warehouse_gap,
      coalesce(wh.has_over_delivered_product, false) as has_over_delivered_product
    from target t
    join public.vendors v on v.id = t.vendor_id
    left join received rc on rc.vendor_id = v.id
    left join delivered dv on dv.vendor_id = v.id
    left join sold sl on sl.vendor_id = v.id
    left join returns rt on rt.vendor_id = v.id
    left join warehouse wh on wh.vendor_id = v.id
    order by v.name asc
    `,
    [vendorIds, rangeStart, rangeEnd, soldSupermarketPaidOnly]
  )

  return rows.map((r) => ({
    vendor_id: String(r.vendor_id),
    vendor_name: String(r.vendor_name ?? ''),
    received: Number(r.received ?? 0),
    delivered: Number(r.delivered ?? 0),
    sold: Number(r.sold ?? 0),
    returns: Number(r.returns ?? 0),
    warehouse_on_hand: Number(r.warehouse_on_hand ?? 0),
    warehouse_gap: Number(r.warehouse_gap ?? 0),
    has_over_delivered_product: Boolean(r.has_over_delivered_product),
  }))
}

export async function fetchVendorActivityProducts(
  pool: Pool,
  vendorId: string,
  rangeStart: string | null,
  rangeEnd: string | null,
  soldSupermarketPaidOnly: boolean
): Promise<VendorActivityProductRow[]> {
  const { rows } = await pool.query(
    `
    with catalog as (
      select p.id, p.name
      from public.products p
      where p.deleted_at is null
        and p.vendor_id = $1::uuid
    ),
    received as (
      select i.product_id, coalesce(sum(i.quantity_received), 0)::int as units
      from public.intakes i
      join catalog c on c.id = i.product_id
      where i.deleted_at is null
        and ($2::date is null or i.received_date >= $2::date)
        and ($3::date is null or i.received_date <= $3::date)
      group by i.product_id
    ),
    delivered as (
      select dri.product_id, coalesce(sum(dri.quantity_delivered), 0)::int as units
      from public.delivery_run_items dri
      join public.delivery_runs dr on dr.id = dri.delivery_run_id
      join catalog c on c.id = dri.product_id
      where dr.deleted_at is null
        and ($2::date is null or dr.delivery_date >= $2::date)
        and ($3::date is null or dr.delivery_date <= $3::date)
      group by dri.product_id
    ),
    sold as (
      select s.product_id, coalesce(sum(s.qty_sold), 0)::int as units
      from public.sales s
      join catalog c on c.id = s.product_id
      where s.deleted_at is null
        and ($2::date is null or s.week_end >= $2::date)
        and ($3::date is null or s.week_start <= $3::date)
        and ($4::boolean is false or s.supermarket_paid = true)
      group by s.product_id
    ),
    returns as (
      select r.product_id, coalesce(sum(r.quantity_returned), 0)::int as units
      from public.product_returns r
      join catalog c on c.id = r.product_id
      where r.deleted_at is null
        and ($2::date is null or r.return_date >= $2::date)
        and ($3::date is null or r.return_date <= $3::date)
      group by r.product_id
    ),
    recv_all as (
      select i.product_id, sum(i.quantity_received)::int as received
      from public.intakes i
      join catalog c on c.id = i.product_id
      where i.deleted_at is null
      group by i.product_id
    ),
    deliv_all as (
      select dri.product_id, sum(dri.quantity_delivered)::int as delivered
      from public.delivery_run_items dri
      join public.delivery_runs dr on dr.id = dri.delivery_run_id
      join catalog c on c.id = dri.product_id
      where dr.deleted_at is null
      group by dri.product_id
    )
    select
      c.id as product_id,
      c.name as product_name,
      coalesce(rc.units, 0) as received,
      coalesce(dv.units, 0) as delivered,
      coalesce(sl.units, 0) as sold,
      coalesce(rt.units, 0) as returns,
      greatest(0, coalesce(ra.received, 0) - coalesce(da.delivered, 0))::int as warehouse_on_hand,
      (coalesce(ra.received, 0) - coalesce(da.delivered, 0))::int as warehouse_gap
    from catalog c
    left join received rc on rc.product_id = c.id
    left join delivered dv on dv.product_id = c.id
    left join sold sl on sl.product_id = c.id
    left join returns rt on rt.product_id = c.id
    left join recv_all ra on ra.product_id = c.id
    left join deliv_all da on da.product_id = c.id
    where
      coalesce(rc.units, 0) > 0
      or coalesce(dv.units, 0) > 0
      or coalesce(sl.units, 0) > 0
      or coalesce(rt.units, 0) > 0
      or greatest(0, coalesce(ra.received, 0) - coalesce(da.delivered, 0)) > 0
      or coalesce(da.delivered, 0) > coalesce(ra.received, 0)
    order by c.name asc
    `,
    [vendorId, rangeStart, rangeEnd, soldSupermarketPaidOnly]
  )

  return rows.map((r) => ({
    product_id: String(r.product_id),
    product_name: String(r.product_name ?? ''),
    received: Number(r.received ?? 0),
    delivered: Number(r.delivered ?? 0),
    sold: Number(r.sold ?? 0),
    returns: Number(r.returns ?? 0),
    warehouse_on_hand: Number(r.warehouse_on_hand ?? 0),
    warehouse_gap: Number(r.warehouse_gap ?? 0),
  }))
}
