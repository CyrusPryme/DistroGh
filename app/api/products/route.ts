import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)
  const vendorIdParam = url.searchParams.get('vendor_id')

  const vendorId =
    session.role === 'vendor' ? (session.vendor_id ?? null) : (vendorIdParam && vendorIdParam.trim() ? vendorIdParam : null)

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      p.*,
      json_build_object(
        'id', v.id,
        'name', v.name,
        'momo_network', v.momo_network,
        'login_email', v.login_email
      ) as vendor
    from public.products p
    join public.vendors v on v.id = p.vendor_id
    where p.deleted_at is null
      and ($1::uuid is null or p.vendor_id = $1::uuid)
    order by p.name asc
    `,
    [vendorId]
  )

  const data = rows.map((row: Record<string, unknown>) => {
    const selling = Number(row.selling_price ?? 0)
    const markup = Number(row.distrogh_markup ?? 0)
    let vendorPrice = Number(row.vendor_price ?? 0)
    if (vendorPrice <= 0 && selling > markup) {
      vendorPrice = Math.round((selling - markup) * 100) / 100
    }
    return { ...row, vendor_price: vendorPrice }
  })

  return NextResponse.json({ success: true, data })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)

  const name = (body?.name ?? '').toString().trim()
  const vendor_id = (body?.vendor_id ?? '').toString().trim()
  const vendor_price = Number(body?.vendor_price ?? 0)
  const distrogh_markup = Number(body?.distrogh_markup ?? 0)
  const expiry_date = body?.expiry_date && String(body.expiry_date).trim() ? String(body.expiry_date).trim() : null

  if (!name) return NextResponse.json({ success: false, error: 'Product name is required' }, { status: 400 })
  if (!vendor_id) return NextResponse.json({ success: false, error: 'Vendor ID is required' }, { status: 400 })
  if (vendor_price < 0 || distrogh_markup < 0) {
    return NextResponse.json({ success: false, error: 'Vendor price and DistroGH markup cannot be negative' }, { status: 400 })
  }
  if (vendor_price === 0 && distrogh_markup === 0) {
    return NextResponse.json({ success: false, error: 'At least one of vendor price or DistroGH markup must be greater than 0' }, { status: 400 })
  }

  const selling_price = vendor_price + distrogh_markup

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    insert into public.products (
      name, vendor_id, vendor_price, distrogh_markup,
      selling_price, commission_percent, expiry_date
    )
    values ($1, $2::uuid, $3, $4, $5, 0, $6)
    returning *
    `,
    [name, vendor_id, vendor_price, distrogh_markup, selling_price, expiry_date]
  )

  return NextResponse.json({ success: true, data: rows[0] }, { status: 201 })
}

