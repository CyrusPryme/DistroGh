import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requirePermission } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { fetchStockTimeline } from '@/lib/vendor-stock-timeline'
import { parseVendorIdList } from '@/lib/vendor-activity'

function normalizeDateParam(v: string | null): string | null {
  const s = (v ?? '').trim()
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export async function GET(req: Request) {
  try {
    await requirePermission('vendors', 'read')
    const url = new URL(req.url)
    const productIds = parseVendorIdList(url.searchParams.get('product_id'))
    const productId = productIds.length === 1 ? productIds[0]! : null
    if (!productId) {
      return NextResponse.json({ success: false, error: 'A valid product_id is required' }, { status: 400 })
    }

    const rangeStart = normalizeDateParam(url.searchParams.get('from'))
    const rangeEnd = normalizeDateParam(url.searchParams.get('to'))

    const pool = getDbPool()
    const { rows: products } = await pool.query<{ name: string; vendor_name: string }>(
      `
      SELECT p.name, v.name AS vendor_name
      FROM products p
      JOIN vendors v ON v.id = p.vendor_id
      WHERE p.id = $1::uuid AND p.deleted_at IS NULL
      `,
      [productId]
    )
    if (!products[0]) {
      return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 })
    }

    const { events, summary } = await fetchStockTimeline(pool, productId, rangeStart, rangeEnd)

    return NextResponse.json({
      success: true,
      data: {
        product_id: productId,
        product_name: products[0].name,
        vendor_name: products[0].vendor_name,
        period: { from: rangeStart, to: rangeEnd },
        summary,
        events,
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load stock timeline')
  }
}
