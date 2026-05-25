import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const email = (url.searchParams.get('email') ?? '').toString().trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 })
  }

  const pool = getDbPool()
  const { rowCount } = await pool.query(
    `select 1 from public.vendor_applications where contact_email = $1 limit 1`,
    [email]
  )

  return NextResponse.json({ success: true, exists: !!rowCount })
}

