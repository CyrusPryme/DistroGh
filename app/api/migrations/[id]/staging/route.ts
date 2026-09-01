import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('historical_migrations', 'read')
    const { id } = await ctx.params
    const url = new URL(req.url)
    const entity = url.searchParams.get('entity_type')
    const status = url.searchParams.get('status')
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
    const offset = Number(url.searchParams.get('offset') || 0)

    const params: unknown[] = [id]
    const where = [`migration_id = $1`]
    if (entity) {
      params.push(entity)
      where.push(`entity_type = $${params.length}`)
    }
    if (status === 'issues') {
      where.push(`validation_status IN ('error', 'warning')`)
    } else if (status) {
      params.push(status)
      where.push(`validation_status = $${params.length}`)
    }
    params.push(limit, offset)

    const pool = getDbPool()
    const { rows } = await pool.query(
      `SELECT id, entity_type, row_number, raw_data, normalized_data, validation_status,
              errors, warnings, infos, match_suggestions, corrections, resolved_refs,
              intended_action, production_id, file_id
       FROM public.migration_staging_rows
       WHERE ${where.join(' AND ')}
       ORDER BY entity_type, row_number
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows WHERE ${where.join(' AND ')}`,
      params.slice(0, params.length - 2)
    )

    return NextResponse.json({
      success: true,
      data: rows,
      total: countRes.rows[0].c,
      limit,
      offset,
    })
  } catch (e) {
    return apiError(e, 'Failed to load staging rows')
  }
}
