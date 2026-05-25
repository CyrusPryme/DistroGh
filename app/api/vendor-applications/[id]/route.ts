import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getDbPool } from '@/lib/db'
import { requireAdminSession } from '@/lib/auth/require'
import { parseDatabaseError, logError } from '@/utils/error-handler'

/** Generate a system password: 12 chars, alphanumeric + 2 symbols for strength. */
function generateSystemPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@'
  let s = ''
  const bytes = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  for (let i = 0; i < 12; i++) s += chars[bytes[i] % chars.length]
  return s
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession()
  const { id } = await ctx.params
  const applicationId = (id ?? '').toString().trim()
  if (!applicationId) {
    return NextResponse.json({ success: false, error: 'Application ID required' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const status = (body?.status ?? '').toString()

  if (status !== 'approved' && status !== 'rejected') {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 })
  }

  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows: appRows } = await client.query(
      `select * from public.vendor_applications where id = $1 limit 1`,
      [applicationId]
    )
    const application = appRows[0]
    if (!application) {
      await client.query('rollback')
      return NextResponse.json({ success: false, error: 'Application not found' }, { status: 404 })
    }

    if (status === 'rejected') {
      const { rows } = await client.query(
        `
        update public.vendor_applications
        set status = 'rejected',
            updated_at = now()
        where id = $1
        returning *
        `,
        [applicationId]
      )
      await client.query('commit')
      return NextResponse.json({ success: true, data: rows[0] })
    }

    // approved
    const storeName = String(application.store_name ?? '').trim()
    const loginEmail = String(application.contact_email ?? '').trim().toLowerCase()
    const initialPassword = generateSystemPassword()

    // Step 1: Reuse existing vendor by name or create new
    const existingVendor = await client.query(
      `
      select id, status
      from public.vendors
      where deleted_at is null and lower(name) = lower($1)
      limit 1
      `,
      [storeName]
    )

    let vendorId: string
    if (existingVendor.rowCount) {
      vendorId = existingVendor.rows[0].id
      await client.query(
        `
        update public.vendors
        set status = 'pending_verification',
            initial_password = $2,
            login_email = $3,
            contact_phone = coalesce(nullif($4, ''), contact_phone),
            description = coalesce($5, description),
            updated_at = now()
        where id = $1
        `,
        [vendorId, initialPassword, loginEmail, String(application.contact_phone ?? ''), application.description ?? null]
      )
    } else {
      const createdVendor = await client.query(
        `
        insert into public.vendors
          (name, momo_number, momo_network, default_commission, status, initial_password, login_email, contact_phone, description)
        values
          ($1, '0000000000', 'MTN', 0, 'pending_verification', $2, $3, nullif($4, ''), $5)
        returning id
        `,
        [storeName, initialPassword, loginEmail, String(application.contact_phone ?? ''), application.description ?? null]
      )
      vendorId = createdVendor.rows[0].id
    }

    // Step 2: Create user + profile for vendor login
    const password_hash = await bcrypt.hash(initialPassword, 10)
    const createdUser = await client.query(
      `
      insert into public.users (email, password_hash)
      values ($1, $2)
      returning id
      `,
      [loginEmail, password_hash]
    )
    const userId = createdUser.rows[0]?.id
    if (!userId) throw new Error('Failed to create vendor user')

    await client.query(
      `
      insert into public.profiles (user_id, role, vendor_id, updated_at)
      values ($1, 'vendor', $2, now())
      on conflict (user_id)
      do update set role = excluded.role, vendor_id = excluded.vendor_id, updated_at = excluded.updated_at
      `,
      [userId, vendorId]
    )

    // Step 3: Mark application approved
    const { rows: updatedApps } = await client.query(
      `
      update public.vendor_applications
      set status = 'approved',
          approved_at = now(),
          approved_by = $2,
          vendor_id = $3,
          updated_at = now()
      where id = $1
      returning *
      `,
      [applicationId, session.user_id, vendorId]
    )

    await client.query('commit')
    return NextResponse.json({
      success: true,
      data: updatedApps[0],
      vendorId,
      initialPassword,
      loginEmail,
    })
  } catch (e: any) {
    await client.query('rollback')
    logError(e, 'api.vendor-applications.PATCH')
    if (e?.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'A user with this email already exists. Use a different email or reset password.' },
        { status: 409 }
      )
    }
    const parsed = parseDatabaseError(e)
    return NextResponse.json({ success: false, error: parsed.userMessage }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireAdminSession()
  const { id } = await ctx.params
  const applicationId = (id ?? '').toString().trim()
  if (!applicationId) {
    return NextResponse.json({ success: false, error: 'Application ID required' }, { status: 400 })
  }

  const pool = getDbPool()
  const { rows } = await pool.query(
    `select id, status from public.vendor_applications where id = $1 limit 1`,
    [applicationId]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ success: false, error: 'Application not found' }, { status: 404 })
  if (row.status === 'pending') {
    return NextResponse.json(
      { success: false, error: 'Cannot remove a pending application. Reject it first.' },
      { status: 400 }
    )
  }

  await pool.query(`delete from public.vendor_applications where id = $1`, [applicationId])
  return NextResponse.json({ success: true })
}

