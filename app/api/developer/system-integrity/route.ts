import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { runSystemIntegrityScan } from '@/lib/system-integrity'

export async function GET() {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const result = await runSystemIntegrityScan(pool)
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    return apiError(e, 'Failed to run system integrity scan')
  }
}
