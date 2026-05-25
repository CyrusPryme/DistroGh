import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'

export async function GET() {
  await requireAdminSession()
  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select * from public.vendors
    order by (deleted_at is not null) asc, name asc
    `
  )
  return NextResponse.json({ success: true, data: rows })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)
  const name = (body?.name ?? '').toString().trim()
  const momo_number = (body?.momo_number ?? '').toString().trim()
  const momo_network = (body?.momo_network ?? '').toString()
  const default_commission = Number(body?.default_commission ?? 0)

  if (!name) return NextResponse.json({ success: false, error: 'Vendor name is required' }, { status: 400 })
  if (!momo_number) return NextResponse.json({ success: false, error: 'Mobile money number is required' }, { status: 400 })
  if (!['MTN', 'Vodafone', 'AirtelTigo'].includes(momo_network)) {
    return NextResponse.json({ success: false, error: 'Invalid mobile money network' }, { status: 400 })
  }
  if (Number.isNaN(default_commission) || default_commission < 0 || default_commission > 100) {
    return NextResponse.json({ success: false, error: 'Commission must be between 0 and 100 percent' }, { status: 400 })
  }

  const pool = getDbPool()

  const byName = await pool.query(
    `select id from public.vendors where deleted_at is null and lower(name) = lower($1) limit 1`,
    [name]
  )
  if (byName.rowCount) {
    return NextResponse.json(
      { success: false, error: 'A vendor with this name already exists. Please update the existing vendor instead of creating a duplicate.' },
      { status: 409 }
    )
  }

  const byMomo = await pool.query(
    `select id from public.vendors where deleted_at is null and momo_number = $1 limit 1`,
    [momo_number]
  )
  if (byMomo.rowCount) {
    return NextResponse.json(
      { success: false, error: 'A vendor with this mobile money number already exists.' },
      { status: 409 }
    )
  }

  const { rows } = await pool.query(
    `
    insert into public.vendors (name, momo_number, momo_network, default_commission)
    values ($1, $2, $3, $4)
    returning *
    `,
    [name, momo_number, momo_network, default_commission]
  )
  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
}

