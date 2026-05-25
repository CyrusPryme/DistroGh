import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'

export async function GET(req: Request) {
  const session = await requireSession()
  if (session.role === 'vendor') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  const url = new URL(req.url)
  const vendorIdParam = url.searchParams.get('vendor_id')?.trim() || null
  const from = url.searchParams.get('from')?.trim() || null
  const to = url.searchParams.get('to')?.trim() || null

  const vendor_id = vendorIdParam

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    select d.*
    from public.vendor_deductions d
    where ($1::uuid is null or d.vendor_id = $1::uuid)
      and ($2::date is null or d.deduction_date >= $2::date)
      and ($3::date is null or d.deduction_date <= $3::date)
    order by d.deduction_date desc, d.created_at desc
    `,
    [vendor_id, from, to]
  )

  return NextResponse.json({ success: true, data: rows })
}

export async function POST(req: Request) {
  await requireAdminSession()
  const body = await req.json().catch(() => null)

  const vendor_id = (body?.vendor_id ?? '').toString().trim()
  const amount = Number(body?.amount ?? 0)
  const reason = (body?.reason ?? '').toString().trim()
  const deduction_date = body?.deduction_date && String(body.deduction_date).trim()
    ? String(body.deduction_date).trim()
    : new Date().toISOString().slice(0, 10)
  const reference_id = body?.reference_id != null && String(body.reference_id).trim() ? String(body.reference_id).trim() : null
  const reference_type = body?.reference_type != null && String(body.reference_type).trim() ? String(body.reference_type).trim() : null

  if (!vendor_id) return NextResponse.json({ success: false, error: 'vendor_id is required' }, { status: 400 })
  if (Number.isNaN(amount) || amount <= 0) return NextResponse.json({ success: false, error: 'amount must be greater than 0' }, { status: 400 })
  if (!reason) return NextResponse.json({ success: false, error: 'reason is required' }, { status: 400 })

  const pool = getDbPool()
  const { rows } = await pool.query(
    `
    insert into public.vendor_deductions (
      vendor_id, amount, reason, deduction_date, reference_id, reference_type
    )
    values ($1::uuid, $2, $3, $4::date, $5, $6)
    returning *
    `,
    [vendor_id, amount, reason, deduction_date, reference_id, reference_type]
  )

  return NextResponse.json({ success: true, data: rows[0] ?? null }, { status: 201 })
}

