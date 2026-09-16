import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { writeAuditLog, actorFromSession, ipFromRequest } from '@/lib/rbac/audit'
import { sqlEffectiveDistroMarkup } from '@/lib/sale-amounts'
import { lifetimeVendorLedgerSumsSql } from '@/lib/reconciliation-ledger'

/** POST /api/developer/reconciliation/run — execute reconciliation for a period */
export async function POST(req: Request) {
  try {
    const session = await requireDeveloper()
    const body = await req.json().catch(() => null)
    const { period_type = 'custom', period_start, period_end, notes } = body ?? {}

    if (!period_start || !period_end) {
      return NextResponse.json({ success: false, error: 'period_start and period_end are required (YYYY-MM-DD).' }, { status: 400 })
    }

    const pool = getDbPool()

    // ── Period activity (informational) + lifetime ledger check ─────────────
    const [salesRow, returnsRow, deductRow, payoutRow, transportRow, ledgerRow, activityRow] =
      await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int as sale_count,
                  ROUND(SUM(s.total_sales)::numeric,2) as total_sales,
                  ROUND(SUM(CASE WHEN s.supermarket_paid THEN s.vendor_due ELSE 0 END)::numeric,2) as vendor_due,
                  ROUND(SUM(s.developer_fee)::numeric,2) as developer_revenue,
                  ROUND(SUM(${sqlEffectiveDistroMarkup('s', 'p')})::numeric,2) as distrogh_revenue
           FROM public.sales s
           JOIN public.products p ON p.id = s.product_id
           WHERE s.deleted_at IS NULL AND s.week_start BETWEEN $1 AND $2`,
          [period_start, period_end]
        ),
        pool.query(
          `SELECT ROUND(SUM(
             r.quantity_returned * COALESCE(r.unit_price, pr.vendor_price, 0)
           )::numeric,2) as returns_value
           FROM public.product_returns r
           JOIN public.products pr ON pr.id = r.product_id
           WHERE r.deleted_at IS NULL AND r.return_date BETWEEN $1 AND $2`,
          [period_start, period_end]
        ),
        pool.query(
          `SELECT ROUND(SUM(amount)::numeric,2) as total_deductions
           FROM public.vendor_deductions WHERE deduction_date BETWEEN $1 AND $2`,
          [period_start, period_end]
        ),
        pool.query(
          `SELECT ROUND(SUM(amount_paid)::numeric,2) as total_payouts
           FROM public.payouts
           WHERE deleted_at IS NULL AND status = 'completed'
             AND payout_date::date BETWEEN $1 AND $2`,
          [period_start, period_end]
        ),
        pool.query(
          `SELECT ROUND(SUM(allocated_amount)::numeric,2) as transport_charges
           FROM public.delivery_run_vendor_charges vc
           JOIN public.delivery_runs dr ON dr.id = vc.delivery_run_id
           WHERE dr.confirmed_at::date BETWEEN $1 AND $2`,
          [period_start, period_end]
        ),
        pool.query(lifetimeVendorLedgerSumsSql(true)),
        pool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM public.sales
              WHERE deleted_at IS NULL AND week_start BETWEEN $1 AND $2)
             + (SELECT COUNT(*)::int FROM public.product_returns
              WHERE deleted_at IS NULL AND return_date BETWEEN $1 AND $2)
             AS activity_count`,
          [period_start, period_end]
        ),
      ])

    const sr = salesRow.rows[0]
    const totalSales = Number(sr?.total_sales ?? 0)
    const totalVendorDue = Number(sr?.vendor_due ?? 0)
    const totalDevRevenue = Number(sr?.developer_revenue ?? 0)
    const totalDistrogh = Number(sr?.distrogh_revenue ?? 0)
    const totalReturns = Number(returnsRow.rows[0]?.returns_value ?? 0)
    const totalDeductions = Number(deductRow.rows[0]?.total_deductions ?? 0)
    const totalPayouts = Number(payoutRow.rows[0]?.total_payouts ?? 0)
    const totalTransport = Number(transportRow.rows[0]?.transport_charges ?? 0)

    const ledger = ledgerRow.rows[0] ?? {}
    const actualBalanceSum = Number(ledger.actual_balance_sum ?? 0)
    const expectedVendorPayable = Number(ledger.expected_balance_sum ?? 0)

    const variance = Math.round((actualBalanceSum - expectedVendorPayable) * 100) / 100
    const variancePct =
      expectedVendorPayable !== 0
        ? Math.round((Math.abs(variance) / Math.abs(expectedVendorPayable)) * 10000) / 100
        : actualBalanceSum !== 0
          ? 100
          : 0

    const activityCount = Number(activityRow.rows[0]?.activity_count ?? 0)

    const threshold = 0.01
    let status: 'balanced' | 'warning' | 'mismatch' | 'no_activity'
    if (activityCount === 0) {
      status = 'no_activity'
    } else if (Math.abs(variance) <= threshold) {
      status = 'balanced'
    } else if (Math.abs(variance) <= threshold * 100) {
      status = 'warning'
    } else {
      status = 'mismatch'
    }

    const { rows: [run] } = await pool.query(
      `INSERT INTO public.reconciliation_runs
         (period_type, period_start, period_end, status,
          total_sales_revenue, total_vendor_due, total_developer_revenue, total_distrogh_revenue,
          total_returns_value, total_deductions, total_payouts_completed, total_transport_charges,
          expected_vendor_payable, actual_vendor_balance_sum, variance, variance_pct, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        period_type,
        period_start,
        period_end,
        status,
        totalSales,
        totalVendorDue,
        totalDevRevenue,
        totalDistrogh,
        totalReturns,
        totalDeductions,
        totalPayouts,
        totalTransport,
        expectedVendorPayable,
        actualBalanceSum,
        variance,
        variancePct,
        notes ?? null,
        session.user_id,
      ]
    )

    await writeAuditLog(pool, {
      ...actorFromSession(session),
      action: 'run_reconciliation',
      module: 'reconciliation',
      target_id: run.id,
      metadata: {
        status,
        variance,
        period_start,
        period_end,
        settled_sales_due: ledger.settled_sales_due,
        returns_deduct: ledger.returns_deduct,
        payouts_recorded: ledger.payouts_recorded,
      },
      ip_address: ipFromRequest(req),
    })

    return NextResponse.json({ success: true, data: run })
  } catch (e) {
    return apiError(e, 'Failed to run reconciliation')
  }
}
