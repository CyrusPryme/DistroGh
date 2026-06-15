import type { Pool, PoolClient } from 'pg'

type Db = Pool | PoolClient

/** One open payout per vendor — pending with balance remaining. */
export async function findOpenPayoutForVendor(
  db: Db,
  vendorId: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query(
    `
    select *
    from public.payouts
    where vendor_id = $1::uuid
      and deleted_at is null
      and status = 'pending'
      and amount_due > coalesce(amount_paid, 0)
    order by created_at desc
    limit 1
    `,
    [vendorId]
  )
  return rows[0] ?? null
}

export async function vendorIdsWithOpenPayouts(db: Db, vendorIds: string[]): Promise<Set<string>> {
  if (vendorIds.length === 0) return new Set()
  const { rows } = await db.query(
    `
    select distinct vendor_id::text as vendor_id
    from public.payouts
    where vendor_id = any($1::uuid[])
      and deleted_at is null
      and status = 'pending'
      and amount_due > coalesce(amount_paid, 0)
    `,
    [vendorIds]
  )
  return new Set(rows.map((r: { vendor_id: string }) => r.vendor_id))
}
