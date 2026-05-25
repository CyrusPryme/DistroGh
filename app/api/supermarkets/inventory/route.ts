import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * Inventory endpoints needed by `services/supermarket.service.ts`:
 * - format=by_supermarket -> flattened rows for supermarket stock view (quantity >= 1)
 * - format=all -> full supermarket_inventory rows with joined supermarket + product objects (includes zeros)
 */
export async function GET(req: Request) {
  try {
    await requireSession()
    const url = new URL(req.url)
    const format = (url.searchParams.get('format') ?? 'by_supermarket').toString()
    const supermarketId = url.searchParams.get('supermarket_id')?.toString().trim() || null

    const pool = getDbPool()

    if (format === 'all') {
      const { rows } = await pool.query(
        `
        select
          si.*,
          json_build_object('id', s.id, 'name', s.name, 'location', s.location) as supermarket,
          json_build_object('id', p.id, 'name', p.name) as product
        from public.supermarket_inventory si
        join public.supermarkets s on s.id = si.supermarket_id and s.deleted_at is null
        join public.products p on p.id = si.product_id and p.deleted_at is null
        where ($1::uuid is null or si.supermarket_id = $1::uuid)
        order by si.supermarket_id asc, si.product_id asc
        `,
        [supermarketId]
      )
      return NextResponse.json({ success: true, data: rows })
    }

    // default: flattened supermarket/product names, only quantity >= 1
    const { rows } = await pool.query(
      `
      select
        si.supermarket_id,
        s.name as supermarket_name,
        si.product_id,
        p.name as product_name,
        si.quantity
      from public.supermarket_inventory si
      join public.supermarkets s on s.id = si.supermarket_id and s.deleted_at is null
      join public.products p on p.id = si.product_id and p.deleted_at is null
      where si.quantity >= 1
        and ($1::uuid is null or si.supermarket_id = $1::uuid)
      order by s.name asc, p.name asc
      `,
      [supermarketId]
    )
    return NextResponse.json({ success: true, data: rows })
  } catch (err) {
    return errorResponse(err)
  }
}

