import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  const session = await requireSession()
  const url = new URL(req.url)

  const vendorIdParam = url.searchParams.get('vendor_id')
  const productId = url.searchParams.get('product_id')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const vendorId = session.role === 'vendor' ? (session.vendor_id ?? null) : (vendorIdParam && vendorIdParam.trim() ? vendorIdParam : null)

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select
      i.*,
      json_build_object(
        'id', p.id,
        'name', p.name,
        'vendor_id', p.vendor_id,
        'vendor', json_build_object('id', v.id, 'name', v.name)
      ) as product,
      json_build_object('id', v.id, 'name', v.name) as vendor
    from public.intakes i
    join public.products p on p.id = i.product_id
    join public.vendors v on v.id = i.vendor_id
    where i.deleted_at is null
      and ($1::uuid is null or i.vendor_id = $1::uuid)
      and ($2::uuid is null or i.product_id = $2::uuid)
      and ($3::date is null or i.received_date >= $3::date)
      and ($4::date is null or i.received_date <= $4::date)
    order by i.received_date desc, i.created_at desc
    `,
    [vendorId, productId && productId.trim() ? productId : null, from && from.trim() ? from : null, to && to.trim() ? to : null]
  )

  return NextResponse.json({ success: true, data: rows })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)
  const payloads = Array.isArray(body) ? body : []
  if (payloads.length === 0) {
    return NextResponse.json({ success: false, error: 'No intake rows provided.' }, { status: 400 })
  }

  const received_date = (payloads[0]?.received_date ?? new Date().toISOString().slice(0, 10)).toString().slice(0, 10)
  const reference = (payloads[0]?.reference ?? null) ? String(payloads[0].reference).trim() : null

  const values: any[] = []
  const tuples: string[] = []
  let i = 1
  for (const p of payloads) {
    const vendor_id = String(p.vendor_id ?? '').trim()
    const product_id = String(p.product_id ?? '').trim()
    const qty = Number(p.quantity_received ?? 0)
    if (!vendor_id || !product_id || qty <= 0) continue
    tuples.push(`($${i++}::uuid, $${i++}::uuid, $${i++}::int, $${i++}::date, $${i++}::text)`)
    values.push(vendor_id, product_id, Math.floor(qty), received_date, reference)
  }
  if (tuples.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid intake rows provided.' }, { status: 400 })
  }

  const pool = getDbPool()
  await pool.query(
    `
    insert into public.intakes (vendor_id, product_id, quantity_received, received_date, reference)
    values ${tuples.join(', ')}
    `,
    values
  )

  return NextResponse.json({ success: true })
}

