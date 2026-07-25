import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'
import { processMigrationJobs } from '@/lib/migration/process'

/** Background worker kick — process queued migration jobs in chunks. */
export async function POST(req: Request) {
  try {
    await requirePermission('historical_migrations', 'update')
    const body = await req.json().catch(() => ({}))
    const results = await processMigrationJobs(getDbPool(), {
      maxJobs: Number(body.max_jobs || 5),
      workerId: body.worker_id || `http-${Date.now()}`,
    })
    return NextResponse.json({ success: true, data: results })
  } catch (e) {
    return apiError(e, 'Job processing failed')
  }
}
