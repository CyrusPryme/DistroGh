/**
 * Vendor balance SQL shared by lib/vendor-earnings.ts and reporting.vendor_balances.
 *
 * Returns only reduce balance when they can reverse vendor liability from
 * supermarket-settled sales (supermarket_paid = true) at the same product + branch.
 * Unsold stock pulled from shelf (no settled sale at that pair) does not change balance.
 */

/** Value of one return line for balance purposes. */
export const RETURN_LINE_VALUE_SQL = `
  coalesce(r.quantity_returned, 0) * coalesce(r.unit_price, pr.vendor_price, 0)
`

/** Per-vendor balance for a single vendor id ($1::uuid). */
export function vendorBalanceSql(includeDeductions: boolean): string {
  const deduct = includeDeductions
    ? `(select total_deductions from deductions_totals)`
    : '0'
  return `
    with settled_by_pair as (
      select
        pr.vendor_id,
        s.product_id,
        s.supermarket_id,
        coalesce(sum(s.vendor_due), 0) as settled_due
      from public.sales s
      join public.products pr on pr.id = s.product_id
      where s.deleted_at is null
        and pr.deleted_at is null
        and pr.vendor_id = $1::uuid
        and s.supermarket_paid = true
      group by pr.vendor_id, s.product_id, s.supermarket_id
    ),
    returns_by_pair as (
      select
        pr.vendor_id,
        r.product_id,
        r.supermarket_id,
        coalesce(sum(${RETURN_LINE_VALUE_SQL}), 0) as return_value
      from public.product_returns r
      join public.products pr on pr.id = r.product_id
      where r.deleted_at is null
        and pr.deleted_at is null
        and pr.vendor_id = $1::uuid
      group by pr.vendor_id, r.product_id, r.supermarket_id
    ),
    sales_totals as (
      select coalesce(sum(settled_due), 0) as total_due from settled_by_pair
    ),
    returns_totals as (
      select coalesce(sum(
        least(rb.return_value, coalesce(sb.settled_due, 0))
      ), 0) as returns_deduct
      from returns_by_pair rb
      left join settled_by_pair sb
        on sb.vendor_id = rb.vendor_id
        and sb.product_id = rb.product_id
        and sb.supermarket_id = rb.supermarket_id
    ),
    deductions_totals as (
      select coalesce(sum(amount), 0) as total_deductions
      from public.vendor_deductions where vendor_id = $1::uuid
    ),
    paid_totals as (
      select coalesce(sum(amount_paid), 0) as total_paid
      from public.payouts
      where vendor_id = $1::uuid and deleted_at is null and status <> 'failed'
    )
    select
      (select total_due from sales_totals)
      - (select returns_deduct from returns_totals)
      - ${deduct}
      - (select total_paid from paid_totals)
      as balance
  `
}

/** Inline vendor list balances when reporting.vendor_balances is unavailable. */
export function allVendorsBalanceFallbackSql(): string {
  return `
    with settled_by_pair as (
      select
        pr.vendor_id,
        s.product_id,
        s.supermarket_id,
        coalesce(sum(s.vendor_due), 0) as settled_due
      from public.sales s
      join public.products pr on pr.id = s.product_id
      where s.deleted_at is null and pr.deleted_at is null and s.supermarket_paid = true
      group by pr.vendor_id, s.product_id, s.supermarket_id
    ),
    returns_by_pair as (
      select
        pr.vendor_id,
        r.product_id,
        r.supermarket_id,
        coalesce(sum(${RETURN_LINE_VALUE_SQL}), 0) as return_value
      from public.product_returns r
      join public.products pr on pr.id = r.product_id
      where r.deleted_at is null and pr.deleted_at is null
      group by pr.vendor_id, r.product_id, r.supermarket_id
    ),
    sales_totals as (
      select vendor_id, coalesce(sum(settled_due), 0) as total_due
      from settled_by_pair
      group by vendor_id
    ),
    returns_totals as (
      select
        rb.vendor_id,
        coalesce(sum(least(rb.return_value, coalesce(sb.settled_due, 0))), 0) as returns_deduct
      from returns_by_pair rb
      left join settled_by_pair sb
        on sb.vendor_id = rb.vendor_id
        and sb.product_id = rb.product_id
        and sb.supermarket_id = rb.supermarket_id
      group by rb.vendor_id
    ),
    deductions_totals as (
      select vendor_id, sum(coalesce(amount, 0)) as total_deductions
      from public.vendor_deductions
      group by vendor_id
    ),
    paid_totals as (
      select vendor_id, sum(coalesce(amount_paid, 0)) as total_paid
      from public.payouts
      where deleted_at is null and status <> 'failed'
      group by vendor_id
    )
    select
      v.id as vendor_id,
      v.name as vendor_name,
      v.momo_number,
      v.momo_network,
      coalesce(st.total_due, 0) as total_due,
      coalesce(pt.total_paid, 0) as total_paid,
      (coalesce(st.total_due, 0) - coalesce(rt.returns_deduct, 0)
        - coalesce(dt.total_deductions, 0) - coalesce(pt.total_paid, 0)) as balance
    from public.vendors v
    left join sales_totals st on st.vendor_id = v.id
    left join returns_totals rt on rt.vendor_id = v.id
    left join deductions_totals dt on dt.vendor_id = v.id
    left join paid_totals pt on pt.vendor_id = v.id
    where v.deleted_at is null
    order by balance desc, vendor_name asc
  `
}
