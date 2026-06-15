import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { checkProductIntegrity } from '@/lib/product-integrity'

export async function GET(req: Request) {
  try {
    await requireSession()
    const url = new URL(req.url)
    const name = url.searchParams.get('name') ?? ''
    const sku = url.searchParams.get('sku') ?? ''
    const barcode = url.searchParams.get('barcode') ?? ''
    const excludeProductId = url.searchParams.get('exclude_product_id')?.trim() || null

    const pool = getDbPool()
    const data = await checkProductIntegrity(pool, {
      name,
      sku,
      barcode,
      excludeProductId,
    })

    return NextResponse.json({ success: true, data })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Integrity check failed'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
