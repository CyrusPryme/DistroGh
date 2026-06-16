import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireSession, requireAdminSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import { findOpenPayoutForVendor, vendorIdsWithOpenPayouts } from '@/lib/payout-open'

async function attachVendor(pool: ReturnType<typeof getDbPool>, payoutId: string) {
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
    where p.id = $1::uuid
    limit 1
    `,
    [payoutId]
  )
  return rows[0] ?? null
}

export async function GET(req: Request) {
  try {
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
  } catch (e) {
    return apiError(e, 'Failed to load payouts')
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminSession()
  const body = await req.json().catch(() => null)

  const vendor_id = (body?.vendor_id ?? '').toString().trim()
  const amount_due = Number(body?.amount_due ?? 0)
  const week_start = (body?.week_start ?? '').toString().trim()
  const week_end = (body?.week_end ?? '').toString().trim()
  const vendor_balances = Array.isArray(body?.vendor_balances) ? body.vendor_balances : null

  const pool = getDbPool()

  if (vendor_balances) {
    const ws = (body?.week_start ?? '').toString().trim()
    const we = (body?.week_end ?? '').toString().trim()
    if (!ws || !we) {
      return NextResponse.json({ success: false, error: 'week_start and week_end are required' }, { status: 400 })
    }

    type BalanceInsert = { vendor_id: string; balance: number }

    const inserts: BalanceInsert[] = (vendor_balances as Array<{ vendor_id?: string; balance?: number }>)
      .map((v) => ({
        vendor_id: (v?.vendor_id ?? '').toString().trim(),
        balance: Number(v?.balance ?? 0),
      }))
      .filter((v): v is BalanceInsert => Boolean(v.vendor_id && v.balance > 0))

    if (inserts.length === 0) {
      return NextResponse.json({ success: true, data: { created: 0, skipped: 0 } }, { status: 201 })
    }

    const vendorIds = inserts.map((v) => v.vendor_id)
    const alreadyOpen = await vendorIdsWithOpenPayouts(pool, vendorIds)
    const toInsert = inserts.filter((v) => !alreadyOpen.has(v.vendor_id))
    const skipped = inserts.length - toInsert.length

    if (toInsert.length > 0) {
      const values: unknown[] = []
      const tuples: string[] = []
      let i = 1
      for (const v of toInsert) {
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
    }

    return NextResponse.json(
      { success: true, data: { created: toInsert.length, skipped } },
      { status: 201 }
    )
  }

  if (!vendor_id) return NextResponse.json({ success: false, error: 'vendor_id is required' }, { status: 400 })
  if (!week_start || !week_end) {
    return NextResponse.json({ success: false, error: 'week_start and week_end are required' }, { status: 400 })
  }
  if (Number.isNaN(amount_due) || amount_due <= 0) {
    return NextResponse.json({ success: false, error: 'amount_due must be greater than 0' }, { status: 400 })
  }

  const existing = await findOpenPayoutForVendor(pool, vendor_id)
  if (existing) {
    const row = await attachVendor(pool, String(existing.id))
    return NextResponse.json(
      {
        success: true,
        data: row,
        reused_existing: true,
        message: 'This vendor already has an open pending payout — using that record.',
      },
      { status: 200 }
    )
  }

  try {
    const { rows } = await pool.query(
      `
      insert into public.payouts (vendor_id, amount_due, amount_paid, status, week_start, week_end)
      values ($1::uuid, $2, 0, 'pending', $3, $4)
      returning *
      `,
      [vendor_id, amount_due, week_start, week_end]
    )
    const row = rows[0] ? await attachVendor(pool, String(rows[0].id)) : null
    return NextResponse.json({ success: true, data: row }, { status: 201 })
  } catch (e: unknown) {
    const pgCode = (e as { code?: string })?.code
    if (pgCode === '23505') {
      const raced = await findOpenPayoutForVendor(pool, vendor_id)
      if (raced) {
        const row = await attachVendor(pool, String(raced.id))
        return NextResponse.json(
          {
            success: true,
            data: row,
            reused_existing: true,
            message: 'This vendor already has an open pending payout — using that record.',
          },
          { status: 200 }
        )
      }
    }
    throw e
  }
  } catch (e) {
    return apiError(e, 'Failed to create payout')
  }
}
