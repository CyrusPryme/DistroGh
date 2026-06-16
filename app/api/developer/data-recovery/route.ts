import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireDeveloper } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'

const SOFT_DELETE_TABLES = [
  { key: 'vendors',      label: 'Vendors',       nameCol: 'name',  idCol: 'id' },
  { key: 'products',     label: 'Products',       nameCol: 'name',  idCol: 'id' },
  { key: 'sales',        label: 'Sales',          nameCol: 'import_batch_id', idCol: 'id' },
  { key: 'payouts',      label: 'Payouts',        nameCol: 'id',    idCol: 'id' },
  { key: 'delivery_runs',label: 'Delivery Runs',  nameCol: 'notes', idCol: 'id' },
] as const

export async function GET(req: Request) {
  try {
    await requireDeveloper()
    const pool = getDbPool()
    const url = new URL(req.url)
    const tableKey = url.searchParams.get('table') ?? 'vendors'

    const tableMeta = SOFT_DELETE_TABLES.find(t => t.key === tableKey)
    if (!tableMeta) return NextResponse.json({ success: false, error: 'Unknown table.' }, { status: 400 })

    const { rows } = await pool.query(
      `SELECT id, ${tableMeta.nameCol} as label, deleted_at
       FROM public.${tableMeta.key}
       WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
       LIMIT 100`
    )

    return NextResponse.json({
      success: true,
      table: tableKey,
      label: tableMeta.label,
      available_tables: SOFT_DELETE_TABLES.map(t => ({ key: t.key, label: t.label })),
      data: rows,
    })
  } catch (e) {
    return apiError(e, 'Failed to load deleted records')
  }
}
