import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireVendorSelfOrAdmin } from '@/lib/auth/require'
import { assertPermission } from '@/lib/auth/permissions'
import { apiError } from '@/lib/api/respond'
import { fetchVendorActivityProducts, parseVendorIdList } from '@/lib/vendor-activity'

function normalizeDateParam(v: string | null): string | null {
  const s = (v ?? '').trim()
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function normalizeVendorId(v: string | null): string | null {
  const ids = parseVendorIdList(v)
  return ids.length === 1 ? ids[0]! : null
}

export async function GET(req: Request) {
  try {
    const session = await requireSession()
    const url = new URL(req.url)
    const rangeStart = normalizeDateParam(url.searchParams.get('from'))
    const rangeEnd = normalizeDateParam(url.searchParams.get('to'))

    let vendorId: string | null
    let soldPaidOnly: boolean

    if (session.role === 'vendor') {
      if (!session.vendor_id) {
        return NextResponse.json({ success: false, error: 'No vendor linked to your account' }, { status: 403 })
      }
      vendorId = session.vendor_id
      soldPaidOnly = true
    } else if (session.role === 'admin') {
      assertPermission(session, 'vendors', 'read')
      vendorId = normalizeVendorId(url.searchParams.get('vendor_id'))
      if (!vendorId) {
        return NextResponse.json({ success: false, error: 'A valid vendor_id is required' }, { status: 400 })
      }
      soldPaidOnly = false
    } else {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    await requireVendorSelfOrAdmin(vendorId)

    const pool = getDbPool()
    const products = await fetchVendorActivityProducts(
      pool,
      vendorId,
      rangeStart,
      rangeEnd,
      soldPaidOnly
    )

    return NextResponse.json({
      success: true,
      data: {
        vendor_id: vendorId,
        products,
        period: { from: rangeStart, to: rangeEnd },
        sold_counts_settled_only: soldPaidOnly,
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load product activity')
  }
}
