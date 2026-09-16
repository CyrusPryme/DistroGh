import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession } from '@/lib/auth/require'
import { assertPermission } from '@/lib/auth/permissions'
import { apiError } from '@/lib/api/respond'
import { fetchVendorActivityRows, parseVendorIdList } from '@/lib/vendor-activity'

function normalizeDateParam(v: string | null): string | null {
  const s = (v ?? '').trim()
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export async function GET(req: Request) {
  try {
    const session = await requireSession()
    const url = new URL(req.url)
    const rangeStart = normalizeDateParam(url.searchParams.get('from'))
    const rangeEnd = normalizeDateParam(url.searchParams.get('to'))

    let vendorIds: string[]
    let soldPaidOnly: boolean

    if (session.role === 'vendor') {
      if (!session.vendor_id) {
        return NextResponse.json({ success: false, error: 'No vendor linked to your account' }, { status: 403 })
      }
      vendorIds = [session.vendor_id]
      soldPaidOnly = true
    } else if (session.role === 'admin') {
      assertPermission(session, 'vendors', 'read')
      vendorIds = parseVendorIdList(url.searchParams.get('vendor_ids'))
      soldPaidOnly = false
    } else {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const pool = getDbPool()
    const rows = await fetchVendorActivityRows(pool, vendorIds, rangeStart, rangeEnd, soldPaidOnly)

    return NextResponse.json({
      success: true,
      data: {
        vendors: rows,
        period: { from: rangeStart, to: rangeEnd },
        sold_counts_settled_only: soldPaidOnly,
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to load vendor activity')
  }
}
