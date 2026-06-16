import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export async function GET() {
  try {
    await requireDeveloper()
    const pool = getDbPool()

    const [tablesRow, migrationRow, pgVersionRow, connRow, errorRow] = await Promise.all([
      pool.query(
        `SELECT relname as table_name,
                n_live_tup as row_count,
                pg_size_pretty(pg_total_relation_size(relid)) as total_size
         FROM pg_stat_user_tables
         ORDER BY pg_total_relation_size(relid) DESC
         LIMIT 20`
      ),
      pool.query(`SELECT id, applied_at FROM public._migrations ORDER BY applied_at DESC`),
      pool.query(`SELECT version() as pg_version`),
      pool.query(`SELECT count(*) as total, count(*) FILTER (WHERE state = 'active') as active FROM pg_stat_activity WHERE datname = current_database()`),
      pool.query(
        `SELECT action, COUNT(*) as count FROM public.audit_logs
         WHERE action IN ('login_failed','permission_denied') AND created_at > now() - interval '24 hours'
         GROUP BY action`
      ),
    ])

    // Sales volume stats
    const statsRow = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM public.vendors WHERE deleted_at IS NULL) as vendor_count,
         (SELECT COUNT(*) FROM public.products WHERE deleted_at IS NULL) as product_count,
         (SELECT COUNT(*) FROM public.sales WHERE deleted_at IS NULL) as sale_count,
         (SELECT COUNT(*) FROM public.payouts WHERE deleted_at IS NULL) as payout_count,
         (SELECT COUNT(*) FROM public.audit_logs) as audit_log_count,
         (SELECT COUNT(*) FROM public.delivery_runs WHERE deleted_at IS NULL) as delivery_count`
    )

    return NextResponse.json({
      success: true,
      data: {
        pg_version: pgVersionRow.rows[0]?.pg_version,
        connections: connRow.rows[0],
        tables: tablesRow.rows,
        migrations: migrationRow.rows,
        security_events_24h: errorRow.rows,
        platform_stats: statsRow.rows[0],
        checked_at: new Date().toISOString(),
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load system health')
  }
}
