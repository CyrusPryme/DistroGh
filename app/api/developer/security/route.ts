import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

export async function GET(req: Request) {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const url = new URL(req.url)
    const hours = Math.min(720, parseInt(url.searchParams.get('hours') ?? '72', 10))

    const [eventsRow, ipRow, loginStatsRow, topActorsRow] = await Promise.all([
      // Security-relevant audit events
      pool.query(
        `SELECT al.id, al.actor_id, al.actor_email, al.action, al.module,
                al.ip_address, al.created_at, al.metadata
         FROM public.audit_logs al
         WHERE al.action IN ('login','logout','login_failed','permission_denied',
                             'create_developer_account','reset_developer_password',
                             'update_fee_config','create_fee_config','restore_record',
                             'delete','bulk_delete','export')
           AND al.created_at > now() - ($1 || ' hours')::interval
         ORDER BY al.created_at DESC
         LIMIT 500`,
        [hours.toString()]
      ),
      // Distinct IPs with most activity
      pool.query(
        `SELECT ip_address, COUNT(*) as event_count, MAX(created_at) as last_seen,
                array_agg(DISTINCT action ORDER BY action) as actions
         FROM public.audit_logs
         WHERE ip_address IS NOT NULL AND created_at > now() - ($1 || ' hours')::interval
         GROUP BY ip_address ORDER BY event_count DESC LIMIT 20`,
        [hours.toString()]
      ),
      // Login success/fail stats by hour
      pool.query(
        `SELECT
           TO_CHAR(created_at, 'YYYY-MM-DD HH24:00') as hour,
           SUM(CASE WHEN action = 'login' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN action = 'login_failed' THEN 1 ELSE 0 END) as failed
         FROM public.audit_logs
         WHERE action IN ('login','login_failed') AND created_at > now() - '48 hours'::interval
         GROUP BY hour ORDER BY hour ASC`
      ),
      // Most active actors
      pool.query(
        `SELECT actor_email, COUNT(*) as event_count, MAX(created_at) as last_active
         FROM public.audit_logs
         WHERE created_at > now() - ($1 || ' hours')::interval AND actor_email IS NOT NULL
         GROUP BY actor_email ORDER BY event_count DESC LIMIT 10`,
        [hours.toString()]
      ),
    ])

    return NextResponse.json({
      success: true,
      data: {
        events: eventsRow.rows,
        ip_activity: ipRow.rows,
        login_timeline: loginStatsRow.rows,
        top_actors: topActorsRow.rows,
        window_hours: hours,
        generated_at: new Date().toISOString(),
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load security data')
  }
}
