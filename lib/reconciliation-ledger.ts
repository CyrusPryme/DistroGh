import { RETURN_LINE_VALUE_SQL } from '@/lib/vendor-balance-sql'

/**
 * Lifetime vendor ledger totals (same rules as reporting.vendor_balances).
 * Used to cross-check SUM(per-vendor balance) vs component roll-up.
 */
export function lifetimeVendorLedgerSumsSql(activeVendorsOnly: boolean): string {
  const vendorFilter = activeVendorsOnly ? `and v.status = 'active'` : ''
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
    per_vendor as (
      select
        v.id as vendor_id,
        coalesce(st.total_due, 0) as total_due,
        coalesce(rt.returns_deduct, 0) as returns_deduct,
        coalesce(dt.total_deductions, 0) as total_deductions,
        coalesce(pt.total_paid, 0) as total_paid,
        (
          coalesce(st.total_due, 0) - coalesce(rt.returns_deduct, 0)
          - coalesce(dt.total_deductions, 0) - coalesce(pt.total_paid, 0)
        ) as balance
      from public.vendors v
      left join (
        select vendor_id, sum(settled_due) as total_due from settled_by_pair group by vendor_id
      ) st on st.vendor_id = v.id
      left join (
        select
          rb.vendor_id,
          sum(least(rb.return_value, coalesce(sb.settled_due, 0))) as returns_deduct
        from returns_by_pair rb
        left join settled_by_pair sb
          on sb.vendor_id = rb.vendor_id
          and sb.product_id = rb.product_id
          and sb.supermarket_id = rb.supermarket_id
        group by rb.vendor_id
      ) rt on rt.vendor_id = v.id
      left join (
        select vendor_id, sum(coalesce(amount, 0)) as total_deductions
        from public.vendor_deductions
        group by vendor_id
      ) dt on dt.vendor_id = v.id
      left join (
        select vendor_id, sum(coalesce(amount_paid, 0)) as total_paid
        from public.payouts
        where deleted_at is null and status <> 'failed'
        group by vendor_id
      ) pt on pt.vendor_id = v.id
      where v.deleted_at is null ${vendorFilter}
    )
    select
      round(coalesce(sum(balance), 0)::numeric, 2) as actual_balance_sum,
      round(coalesce(sum(total_due), 0)::numeric, 2) as settled_sales_due,
      round(coalesce(sum(returns_deduct), 0)::numeric, 2) as returns_deduct,
      round(coalesce(sum(total_deductions), 0)::numeric, 2) as total_deductions,
      round(coalesce(sum(total_paid), 0)::numeric, 2) as payouts_recorded,
      round(
        (
          coalesce(sum(total_due), 0) - coalesce(sum(returns_deduct), 0)
          - coalesce(sum(total_deductions), 0) - coalesce(sum(total_paid), 0)
        )::numeric,
        2
      ) as expected_balance_sum
    from per_vendor
  `
}
