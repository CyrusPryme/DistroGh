import type { Pool, PoolClient } from 'pg'
import { roundMoney, toSqlDate, normalizeSaleMonthPeriod } from '@/lib/utils'
import { normalizeSalesRowData, isPaidMarker } from '@/lib/migration/sales-fields'
import { writeMigrationAudit } from '@/lib/migration/audit'
import { payoutIsFullyPaid } from '@/lib/payout-amounts'

export type SalesPayoutGroup = {
  vendorId: string
  weekStart: string
  weekEnd: string
  amountDue: number
  vendorPaid: boolean
  saleRowCount: number
}

function migrationPayoutRef(migrationId: string): string {
  return `MIG-SALES-${migrationId.slice(0, 8)}`
}

/** Group imported sales staging rows by vendor + calendar month for payout generation. */
export async function aggregateSalesPayoutGroups(
  pool: Pool | PoolClient,
  migrationId: string
): Promise<{ groups: SalesPayoutGroup[]; skippedRows: number }> {
  const { rows } = await pool.query(
    `SELECT raw_data, corrections, normalized_data, resolved_refs
     FROM public.migration_staging_rows
     WHERE migration_id = $1
       AND entity_type = 'sales'
       AND production_id IS NOT NULL
       AND intended_action <> 'skip'
       AND validation_status IN ('valid','warning','corrected')`,
    [migrationId]
  )

  const { rows: productVendors } = await pool.query(
    `SELECT id, vendor_id FROM public.products WHERE deleted_at IS NULL`
  )
  const vendorByProduct = new Map(
    (productVendors as Array<{ id: string; vendor_id: string }>).map((p) => [p.id, p.vendor_id])
  )

  const groups = new Map<string, SalesPayoutGroup>()
  let skippedRows = 0

  for (const row of rows) {
    const raw = {
      ...(row.raw_data as Record<string, unknown>),
      ...(row.corrections as Record<string, unknown>),
    }
    const data = normalizeSalesRowData(raw)
    const refs = (row.resolved_refs ?? {}) as Record<string, string>
    const norm = (row.normalized_data ?? {}) as Record<string, unknown>

    const productId = refs.product_id
    const vendorId = refs.vendor_id || (productId ? vendorByProduct.get(productId) : undefined)
    const periodSource = String(norm.week_start ?? data.week_start ?? norm.report_month ?? data.report_month ?? '')
    if (!vendorId || !periodSource) {
      skippedRows++
      continue
    }

    let period: { week_start: string; week_end: string }
    try {
      period = normalizeSaleMonthPeriod(toSqlDate(periodSource))
    } catch {
      skippedRows++
      continue
    }

    const vendorDue = roundMoney(Number(norm.vendor_due ?? data.vendor_due ?? data.TCostEx ?? 0))
    if (vendorDue <= 0) {
      skippedRows++
      continue
    }

    const key = `${vendorId}::${period.week_start}`
    const paid = isPaidMarker(data.paid ?? data.PAID)
    const existing = groups.get(key)
    if (existing) {
      existing.amountDue = roundMoney(existing.amountDue + vendorDue)
      existing.vendorPaid = existing.vendorPaid || paid
      existing.saleRowCount++
    } else {
      groups.set(key, {
        vendorId,
        weekStart: period.week_start,
        weekEnd: period.week_end,
        amountDue: vendorDue,
        vendorPaid: paid,
        saleRowCount: 1,
      })
    }
  }

  return { groups: [...groups.values()], skippedRows }
}

export async function salesPayoutsAlreadyGenerated(
  pool: Pool | PoolClient,
  migrationId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM public.migration_phase_results
     WHERE migration_id = $1 AND phase = 'import' AND entity_type = 'payouts'
       AND reconciliation->>'source' = 'sales_paid_flags'
     LIMIT 1`,
    [migrationId]
  )
  return rows.length > 0
}

/** True when this migration has sales to import but no explicit payouts upload. */
export async function shouldGenerateSalesPayouts(
  pool: Pool | PoolClient,
  migrationId: string
): Promise<boolean> {
  const { rows: sales } = await pool.query(
    `SELECT 1 FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'sales' LIMIT 1`,
    [migrationId]
  )
  if (!sales.length) return false

  const { rows: explicitPayouts } = await pool.query(
    `SELECT 1 FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'payouts'
       AND intended_action <> 'skip'
     LIMIT 1`,
    [migrationId]
  )
  if (explicitPayouts.length) return false

  return !(await salesPayoutsAlreadyGenerated(pool, migrationId))
}

/**
 * After all sales rows for a migration are imported, create one payout per vendor+month from
 * aggregated vendor_due totals. PAID flags on sales rows mark the payout completed; blank = pending.
 */
export async function generatePayoutsFromSalesMigration(
  pool: Pool,
  migrationId: string,
  actorId?: string | null
): Promise<{ created: number; skipped: number; updated: number; groups: number } | null> {
  if (!(await shouldGenerateSalesPayouts(pool, migrationId))) {
    return null
  }

  const { rows: remaining } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'sales'
       AND production_id IS NULL
       AND validation_status IN ('valid','warning','corrected')
       AND intended_action <> 'skip'`,
    [migrationId]
  )
  if (Number(remaining[0]?.c ?? 0) > 0) {
    return null
  }

  const { groups, skippedRows } = await aggregateSalesPayoutGroups(pool, migrationId)
  if (!groups.length) {
    await pool.query(
      `INSERT INTO public.migration_phase_results
        (migration_id, phase, entity_type, expected_count, imported_count, skipped_count, status, reconciliation, started_at, completed_at)
       VALUES ($1,'import','payouts',0,0,$2,'balanced',$3::jsonb, now(), now())
       ON CONFLICT (migration_id, phase, entity_type) DO NOTHING`,
      [migrationId, skippedRows, JSON.stringify({ source: 'sales_paid_flags', note: 'no_eligible_groups' })]
    )
    return { created: 0, skipped: skippedRows, updated: 0, groups: 0 }
  }

  const client = await pool.connect()
  const productionIds: string[] = []
  let created = 0
  let skipped = 0
  let updated = 0
  const momoRef = migrationPayoutRef(migrationId)

  try {
    await client.query('BEGIN')

    for (const group of groups) {
      const { rows: fromThisMigration } = await client.query(
        `SELECT id FROM public.payouts
         WHERE vendor_id = $1 AND week_start = $2::date AND week_end = $3::date
           AND deleted_at IS NULL AND momo_txn_id = $4
         LIMIT 1`,
        [group.vendorId, group.weekStart, group.weekEnd, momoRef]
      )
      if (fromThisMigration[0]) {
        skipped++
        productionIds.push(String(fromThisMigration[0].id))
        continue
      }

      const { rows: existingPayout } = await client.query(
        `SELECT id, status, amount_due, amount_paid FROM public.payouts
         WHERE vendor_id = $1 AND week_start = $2::date AND week_end = $3::date
           AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [group.vendorId, group.weekStart, group.weekEnd]
      )

      if (existingPayout[0]) {
        const ep = existingPayout[0] as {
          id: string
          status: string
          amount_due: string
          amount_paid: string
        }
        if (group.vendorPaid && ep.status === 'pending') {
          const amountDue = roundMoney(Math.max(Number(ep.amount_due), group.amountDue))
          await client.query(
            `UPDATE public.payouts
             SET amount_due = $2, amount_paid = $3, status = 'completed',
                 payout_date = COALESCE(payout_date, now()), updated_at = now()
             WHERE id = $1`,
            [ep.id, amountDue, amountDue]
          )
          productionIds.push(ep.id)
          updated++
        } else {
          skipped++
        }
        continue
      }

      const status = group.vendorPaid ? 'completed' : 'pending'
      const amountPaid = group.vendorPaid ? group.amountDue : 0
      if (status === 'completed' && !payoutIsFullyPaid({ amount_due: group.amountDue, amount_paid: amountPaid })) {
        throw new Error('Completed historical payout would not be fully paid')
      }

      const ins = await client.query(
        `INSERT INTO public.payouts
          (vendor_id, amount_due, amount_paid, week_start, week_end, status, momo_txn_id, payout_date)
         VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8)
         RETURNING id`,
        [
          group.vendorId,
          group.amountDue,
          amountPaid,
          group.weekStart,
          group.weekEnd,
          status,
          momoRef,
          group.vendorPaid ? new Date().toISOString() : null,
        ]
      )
      productionIds.push(String(ins.rows[0].id))
      created++
    }

    await client.query(
      `INSERT INTO public.migration_phase_results
        (migration_id, phase, entity_type, expected_count, imported_count, updated_count, skipped_count, status, production_ids, reconciliation, started_at, completed_at)
       VALUES ($1,'import','payouts',$2,$3,$4,$5,'balanced',$6::uuid[],$7::jsonb, now(), now())
       ON CONFLICT (migration_id, phase, entity_type) DO UPDATE SET
         imported_count = EXCLUDED.imported_count,
         updated_count = EXCLUDED.updated_count,
         skipped_count = EXCLUDED.skipped_count,
         production_ids = EXCLUDED.production_ids,
         reconciliation = EXCLUDED.reconciliation,
         completed_at = now()`,
      [
        migrationId,
        groups.length,
        created,
        updated,
        skipped + skippedRows,
        productionIds,
        JSON.stringify({ source: 'sales_paid_flags', groups: groups.length }),
      ]
    )

    await writeMigrationAudit(client, {
      migrationId,
      actorId,
      action: 'migration.sales_payouts_generated',
      details: { created, updated, skipped, groups: groups.length },
    })

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

  return { created, skipped: skipped + skippedRows, updated, groups: groups.length }
}
