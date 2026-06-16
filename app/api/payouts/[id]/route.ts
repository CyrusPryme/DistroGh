import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { requireAdminSession, requireSession } from '@/lib/auth/require'
import { apiError } from '@/lib/api/respond'
import {
  appendMomoTxnId,
  payoutAmountDue,
  payoutAmountPaid,
  payoutBalanceRemaining,
  resolvePayoutStatusAfterPayment,
} from '@/lib/payout-amounts'
import { roundMoney } from '@/lib/utils'

async function fetchPayoutWithVendor(pool: ReturnType<typeof getDbPool>, payoutId: string) {
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `
      select
        p.*,
        json_build_object(
          'id', v.id,
          'name', v.name,
          'momo_number', v.momo_number,
          'momo_network', v.momo_network
        ) as vendor
      from public.payouts p
      join public.vendors v on v.id = p.vendor_id
      where p.id = $1::uuid and p.deleted_at is null
        and ($2::uuid is null or p.vendor_id = $2::uuid)
      limit 1
      `,
      [id, session.role === 'vendor' ? (session.vendor_id ?? null) : null]
    )
    return NextResponse.json({ success: true, data: rows[0] ?? null })
  } catch (e) {
    return apiError(e, 'Failed to load payout')
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const pool = getDbPool()
    const client = await pool.connect()

    try {
      await client.query('begin')

      const currentRes = await client.query(
        `select * from public.payouts where id = $1::uuid and deleted_at is null for update`,
        [id]
      )
      const current = currentRes.rows[0]
      if (!current) {
        await client.query('rollback')
        return NextResponse.json({ success: false, error: 'Payout not found.' }, { status: 404 })
      }

      if (body?.record_payment === true) {
        const paymentAmount = roundMoney(Number(body?.payment_amount ?? 0))
        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
          await client.query('rollback')
          return NextResponse.json(
            { success: false, error: 'Payment amount must be greater than 0' },
            { status: 400 }
          )
        }

        const amountDue = payoutAmountDue(current)
        const alreadyPaid = payoutAmountPaid(current)
        const remaining = payoutBalanceRemaining(current)

        if (remaining <= 0) {
          await client.query('rollback')
          return NextResponse.json(
            { success: false, error: 'This payout is already fully paid' },
            { status: 400 }
          )
        }

        if (paymentAmount > remaining + 0.001) {
          await client.query('rollback')
          return NextResponse.json(
            {
              success: false,
              error: `Payment cannot exceed remaining balance (${remaining.toFixed(2)} GHS)`,
            },
            { status: 400 }
          )
        }

        const newPaid = roundMoney(alreadyPaid + paymentAmount)
        const newStatus = resolvePayoutStatusAfterPayment(amountDue, newPaid)
        const txnRaw = body?.momo_txn_id != null ? String(body.momo_txn_id).trim() : ''
        const momoTxnId = txnRaw ? appendMomoTxnId(current.momo_txn_id, txnRaw) : current.momo_txn_id

        const updated = await client.query(
          `
          update public.payouts
          set
            amount_paid = $1,
            status = $2,
            momo_txn_id = $3,
            payout_date = case when $2 = 'completed' then now() else payout_date end,
            updated_at = now()
          where id = $4::uuid
          returning id
          `,
          [newPaid, newStatus, momoTxnId, id]
        )

        await client.query('commit')
        const row = await fetchPayoutWithVendor(pool, String(updated.rows[0]?.id ?? id))
        return NextResponse.json({ success: true, data: row })
      }

      const fields: string[] = []
      const values: unknown[] = []
      let i = 1

      function setField(key: string, value: unknown) {
        fields.push(`${key} = $${i++}`)
        values.push(value)
      }

      if (body && Object.prototype.hasOwnProperty.call(body, 'status')) {
        setField('status', String(body.status ?? '').trim())
      }
      if (body && Object.prototype.hasOwnProperty.call(body, 'amount_paid')) {
        const nextPaid = roundMoney(Number(body.amount_paid ?? 0))
        const amountDue = payoutAmountDue(current)
        if (nextPaid > amountDue + 0.001) {
          await client.query('rollback')
          return NextResponse.json(
            { success: false, error: 'Amount paid cannot exceed amount due' },
            { status: 400 }
          )
        }
        setField('amount_paid', nextPaid)
        if (!body || !Object.prototype.hasOwnProperty.call(body, 'status')) {
          setField('status', resolvePayoutStatusAfterPayment(amountDue, nextPaid))
        }
      }
      if (body && Object.prototype.hasOwnProperty.call(body, 'momo_txn_id')) {
        const v =
          body.momo_txn_id != null && String(body.momo_txn_id).trim() ? String(body.momo_txn_id).trim() : null
        setField('momo_txn_id', v)
      }
      if (body && Object.prototype.hasOwnProperty.call(body, 'deleted_at')) {
        setField('deleted_at', body.deleted_at ? String(body.deleted_at) : null)
      }

      const status = body?.status != null ? String(body.status).trim() : null
      if (status === 'completed') setField('payout_date', new Date().toISOString())

      if (fields.length === 0) {
        await client.query('rollback')
        return NextResponse.json({ success: false, error: 'No fields to update.' }, { status: 400 })
      }

      values.push(id)
      const updated = await client.query(
        `
        update public.payouts
        set ${fields.join(', ')}, updated_at = now()
        where id = $${i}::uuid
        returning id
        `,
        values
      )

      await client.query('commit')
      const row = await fetchPayoutWithVendor(pool, String(updated.rows[0]?.id ?? id))
      if (!row) return NextResponse.json({ success: false, error: 'Payout not found.' }, { status: 404 })
      return NextResponse.json({ success: true, data: row })
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    return apiError(e, 'Failed to update payout')
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession()
    const { id } = await ctx.params
    const pool = getDbPool()
    const { rows } = await pool.query(
      `update public.payouts set deleted_at = now(), updated_at = now() where id = $1::uuid and deleted_at is null returning id`,
      [id]
    )
    if (!rows[0]) return NextResponse.json({ success: false, error: 'Payout not found.' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 'Failed to delete payout')
  }
}
