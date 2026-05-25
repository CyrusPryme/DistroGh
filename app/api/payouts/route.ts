import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.trim() || null
  const vendorIdParam = url.searchParams.get('vendor_id')?.trim() || null

  const vendorId =
    session.role === 'vendor' ? (session.vendor_id ?? null) : vendorIdParam

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      p.*,
      json_build_object(
        'id', v.id,
        'name', v.name,
        'momo_number', v.momo_number,
        'momo_network', v.momo_network,
        'deleted_at', v.deleted_at
      ) as vendor
    from public.payouts p
    join public.vendors v on v.id = p.vendor_id
    where p.deleted_at is null
      and ($1::uuid is null or p.vendor_id = $1::uuid)
      and ($2::text is null or p.status = $2::text)
    order by p.created_at desc
    `,
    [vendorId, status]
  )

  return NextResponse.json({ success: true, data: rows })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)

  // Single create (existing service method)
  const vendor_id = (body?.vendor_id ?? '').toString().trim()
  const amount_due = Number(body?.amount_due ?? 0)
  const week_start = (body?.week_start ?? '').toString().trim()
  const week_end = (body?.week_end ?? '').toString().trim()

  // Bulk create (existing service method)
  const vendor_balances = Array.isArray(body?.vendor_balances) ? body.vendor_balances : null

  const pool = getDbPool()

  if (vendor_balances) {
    const ws = (body?.week_start ?? '').toString().trim()
    const we = (body?.week_end ?? '').toString().trim()
    if (!ws || !we) {
      return NextResponse.json({ success: false, error: 'week_start and week_end are required' }, { status: 400 })
    }

    const inserts = vendor_balances
      .map((v: any) => ({
        vendor_id: (v?.vendor_id ?? '').toString().trim(),
        balance: Number(v?.balance ?? 0),
      }))
      .filter((v: any) => v.vendor_id && v.balance > 0)

    if (inserts.length === 0) return NextResponse.json({ success: true, data: [] }, { status: 201 })

    const values: any[] = []
    const tuples: string[] = []
    let i = 1
    for (const v of inserts) {
      tuples.push(`($${i++}::uuid, $${i++}, 0, 'pending', $${i++}, $${i++})`)
      values.push(v.vendor_id, v.balance, ws, we)
    }

    await pool.query(
      `
      insert into public.payouts (vendor_id, amount_due, amount_paid, status, week_start, week_end)
      values ${tuples.join(', ')}
      `,
      values
    )

    return NextResponse.json({ success: true, data: [] }, { status: 201 })
  }

  if (!vendor_id) return NextResponse.json({ success: false, error: 'vendor_id is required' }, { status: 400 })
  if (!week_start || !week_end) {
    return NextResponse.json({ success: false, error: 'week_start and week_end are required' }, { status: 400 })
  }
  if (Number.isNaN(amount_due) || amount_due <= 0) {
    return NextResponse.json({ success: false, error: 'amount_due must be greater than 0' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `
    insert into public.payouts (vendor_id, amount_due, amount_paid, status, week_start, week_end)
    values ($1::uuid, $2, 0, 'pending', $3, $4)
    returning *
    `,
    [vendor_id, amount_due, week_start, week_end]
  )

  return NextResponse.json({ success: true, data: rows[0] ?? null }, { status: 201 })
}

