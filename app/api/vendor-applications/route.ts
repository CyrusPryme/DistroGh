import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import type { VendorApplication } from '@/types/vendor-application'
import { parseDatabaseError, logError } from '@/utils/error-handler'

function toVendorApplication(row: any): VendorApplication {
  return row as VendorApplication
}

export async function POST(req: Request) {
  // Public endpoint (landing page) — no session required.
  const body = await req.json().catch(() => null)
  const store_name = (body?.store_name ?? '').toString().trim()
  const contact_email = (body?.contact_email ?? '').toString().trim().toLowerCase()
  const contact_phone = (body?.contact_phone ?? '').toString().trim()
  const descriptionRaw = (body?.description ?? '').toString()
  const description = descriptionRaw.trim() ? descriptionRaw.trim() : null

  if (!store_name) {
    return NextResponse.json({ success: false, error: 'Store name is required' }, { status: 400 })
  }
  if (!contact_email) {
    return NextResponse.json({ success: false, error: 'Contact email is required' }, { status: 400 })
  }

  try {
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      insert into public.vendor_applications (store_name, contact_email, contact_phone, description)
      values ($1, $2, nullif($3, ''), $4)
      returning *
      `,
      [store_name, contact_email, contact_phone, description]
    )

    return NextResponse.json({ success: true, data: toVendorApplication(rows[0]) }, { status: 201 })
  } catch (e: any) {
    logError(e, 'api.vendor-applications.POST')
    if (e?.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'An application with this email already exists.' },
        { status: 409 }
      )
    }
    const parsed = parseDatabaseError(e)
    return NextResponse.json({ success: false, error: parsed.userMessage }, { status: 500 })
  }
}

export async function GET(req: Request) {
  await requireAdminSession()

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const includeRejected = url.searchParams.get('includeRejected') === 'true'

  const pool = getDbPool()
  const params: any[] = []
  const where: string[] = []

  if (status) {
    params.push(status)
    where.push(`status = $${params.length}`)
  }
  if (!includeRejected) {
    where.push(`status <> 'rejected'`)
  }

  const whereSql = where.length ? `where ${where.join(' and ')}` : ''

  const { rows } = await pool.query(
    `
    select *
    from public.vendor_applications
    ${whereSql}
    order by created_at desc
    `,
    params
  )

  return NextResponse.json({ success: true, data: rows.map(toVendorApplication) })
}

