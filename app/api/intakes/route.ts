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
    limit 20000
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

  const candidates: { vendor_id: string; product_id: string; qty: number }[] = []
  for (const p of payloads) {
    const vendor_id = String(p.vendor_id ?? '').trim()
    const product_id = String(p.product_id ?? '').trim()
    const qty = Number(p.quantity_received ?? 0)
    if (!vendor_id || !product_id || qty <= 0) continue
    candidates.push({ vendor_id, product_id, qty: Math.floor(qty) })
  }
  if (candidates.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid intake rows provided.' }, { status: 400 })
  }

  const pool = getDbPool()

  // Guard against corrupting stock math: every product_id must actually belong to the
  // vendor_id it's paired with (a mismatched pair would attribute another vendor's stock).
  const productIds = [...new Set(candidates.map((c) => c.product_id))]
  const { rows: productRows } = await pool.query(
    `select id, vendor_id from public.products where id = any($1::uuid[]) and deleted_at is null`,
    [productIds]
  )
  const productVendorMap = new Map(productRows.map((r: { id: string; vendor_id: string }) => [r.id, r.vendor_id]))
  const mismatched = candidates.find((c) => productVendorMap.get(c.product_id) !== c.vendor_id)
  if (mismatched) {
    return NextResponse.json(
      { success: false, error: 'One or more products do not belong to the specified vendor.' },
      { status: 400 }
    )
  }

  const values: any[] = []
  const tuples: string[] = []
  let i = 1
  for (const c of candidates) {
    tuples.push(`($${i++}::uuid, $${i++}::uuid, $${i++}::int, $${i++}::date, $${i++}::text)`)
    values.push(c.vendor_id, c.product_id, c.qty, received_date, reference)
  }

  await pool.query(
    `
    insert into public.intakes (vendor_id, product_id, quantity_received, received_date, reference)
    values ${tuples.join(', ')}
    `,
    values
  )

  return NextResponse.json({ success: true })
}

