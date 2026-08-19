import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { apiError } from '@/lib/api/respond'
import { requirePermission } from '@/lib/auth/require'

type SettlementBody = {
  supermarket_paid?: boolean
  sale_ids?: string[]
  week_start?: string
  week_end?: string
  supermarket_id?: string
}

/** Bulk-update supermarket settlement (supermarket paid DistroGH) on sale lines. */
export async function POST(req: Request) {
  try {
    await requirePermission('sales', 'update')
    const body = (await req.json().catch(() => null)) as SettlementBody | null
    if (!body || typeof body.supermarket_paid !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'supermarket_paid (true/false) is required' },
        { status: 400 }
      )
    }

    const saleIds = Array.isArray(body.sale_ids)
      ? body.sale_ids.map((id) => String(id).trim()).filter(Boolean)
      : []

    const weekStart = String(body.week_start ?? '').trim() || null
    const weekEnd = String(body.week_end ?? '').trim() || null
    const supermarketId = String(body.supermarket_id ?? '').trim() || null

    if (!saleIds.length && !(weekStart && weekEnd)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Provide sale_ids or a report month (week_start + week_end). Optional supermarket_id narrows bulk updates.',
        },
        { status: 400 }
      )
    }

    const pool = getDbPool()
    let result
    if (saleIds.length) {
      result = await pool.query(
        `UPDATE public.sales
         SET supermarket_paid = $2, updated_at = now()
         WHERE deleted_at IS NULL AND id = ANY($1::uuid[])`,
        [saleIds, body.supermarket_paid]
      )
    } else {
      result = await pool.query(
        `UPDATE public.sales
         SET supermarket_paid = $4, updated_at = now()
         WHERE deleted_at IS NULL
           AND week_start = $1::date
           AND week_end = $2::date
           AND ($3::uuid IS NULL OR supermarket_id = $3::uuid)`,
        [weekStart, weekEnd, supermarketId, body.supermarket_paid]
      )
    }

    return NextResponse.json({
      success: true,
      data: { updated: result.rowCount ?? 0, supermarket_paid: body.supermarket_paid },
    })
  } catch (e) {
    return apiError(e, 'Failed to update supermarket settlement')
  }
}
