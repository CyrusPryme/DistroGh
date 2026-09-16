import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requirePermission } from '@/lib/auth/require'
import { allVendorsBalanceFallbackSql } from '@/lib/vendor-balance-sql'

export async function GET() {
  try {
    await requirePermission('payouts', 'read')
    const pool = getDbPool()
    let rows: Record<string, unknown>[]
    try {
      const result = await pool.query(
        `
        select
          vendor_id,
          vendor_name,
          momo_number,
          momo_network,
          total_due,
          total_paid,
          balance
        from reporting.vendor_balances
        order by balance desc, vendor_name asc
        `
      )
      rows = result.rows
    } catch {
      const result = await pool.query(allVendorsBalanceFallbackSql())
      rows = result.rows
    }
    const data = rows.map((row) => ({
      vendor_id: String(row.vendor_id),
      vendor_name: String(row.vendor_name ?? ''),
      momo_number: String(row.momo_number ?? ''),
      momo_network: row.momo_network,
      total_due: Number(row.total_due ?? 0),
      total_paid: Number(row.total_paid ?? 0),
      balance: Number(row.balance ?? 0),
    }))
    return NextResponse.json({ success: true, data })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load vendor balances'
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500
    return NextResponse.json({ success: false, error: msg }, { status })
  }
}
