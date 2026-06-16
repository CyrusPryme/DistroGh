import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export async function GET() {
  try {
    await requireDeveloper()
    const pool = getDbPool()

    const [tableStatsRow, indexStatsRow, dbSizeRow, longQueryRow, migrationRow] = await Promise.all([
      pool.query(
        `SELECT relname as table_name,
                seq_scan, idx_scan,
                n_live_tup as live_rows, n_dead_tup as dead_rows,
                pg_size_pretty(pg_total_relation_size(relid)) as total_size,
                pg_total_relation_size(relid) as size_bytes,
                last_autovacuum, last_autoanalyze
         FROM pg_stat_user_tables
         ORDER BY pg_total_relation_size(relid) DESC
         LIMIT 30`
      ),
      pool.query(
        `SELECT indexrelname as index_name, relname as table_name,
                idx_scan, idx_tup_read, idx_tup_fetch,
                pg_size_pretty(pg_relation_size(indexrelid)) as index_size
         FROM pg_stat_user_indexes
         ORDER BY idx_scan ASC
         LIMIT 20`
      ),
      pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) as db_size, current_database() as db_name`),
      pool.query(
        `SELECT pid, now() - query_start as duration, state, left(query, 200) as query
         FROM pg_stat_activity
         WHERE datname = current_database() AND state != 'idle' AND query_start IS NOT NULL
         ORDER BY duration DESC NULLS LAST
         LIMIT 10`
      ),
      pool.query(`SELECT id, applied_at FROM public._migrations ORDER BY applied_at ASC`),
    ])

    return NextResponse.json({
      success: true,
      data: {
        database: dbSizeRow.rows[0],
        tables: tableStatsRow.rows,
        indexes: indexStatsRow.rows,
        active_queries: longQueryRow.rows,
        migrations: migrationRow.rows,
        checked_at: new Date().toISOString(),
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load database stats')
  }
}
