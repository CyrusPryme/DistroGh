import type { Pool } from 'pg'

const TOLERANCE = 0.05 // GHS rounding tolerance for arithmetic cross-checks

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export interface FinancialDiscrepancy {
  entity_type: string
  category: string
  expected_value: number | null
  actual_value: number | null
  difference: number | null
  details: Record<string, unknown>
  severity: 'info' | 'warning' | 'error'
}

/**
 * Cross-check the arithmetic *within* each staged historical financial record before
 * committing it to production. This does not invent business figures that aren't
 * derivable from the source row (e.g. developer fees, which depend on live fee config) —
 * it flags rows whose own numbers are internally inconsistent, which is the class of
 * error most likely to silently corrupt vendor payouts/commissions during migration.
 */
export async function computeFinancialIntegrityChecks(
  pool: Pool,
  migrationId: string
): Promise<FinancialDiscrepancy[]> {
  const discrepancies: FinancialDiscrepancy[] = []

  const { rows: salesRows } = await pool.query(
    `SELECT id, row_number, file_id, normalized_data, corrections
     FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'sales'
       AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
    [migrationId]
  )

  let expectedSalesTotal = 0
  let actualSalesTotal = 0
  let mismatchedRows = 0

  for (const row of salesRows) {
    const d = { ...(row.normalized_data as object), ...(row.corrections as object) } as Record<string, unknown>
    const qty = num(d.qty ?? d.quantity)
    const unitPrice = num(d.unit_price ?? d.shop_unit_price)
    const totalSales = num(d.total_sales)
    const vendorDue = num(d.vendor_due)
    const commission = num(d.commission_amount)

    if (qty != null && unitPrice != null && totalSales != null) {
      const expected = Math.round(qty * unitPrice * 100) / 100
      expectedSalesTotal += expected
      actualSalesTotal += totalSales
      if (Math.abs(expected - totalSales) > TOLERANCE) {
        mismatchedRows++
        discrepancies.push({
          entity_type: 'sales',
          category: 'line_total_mismatch',
          expected_value: expected,
          actual_value: totalSales,
          difference: Math.round((totalSales - expected) * 100) / 100,
          details: { row_number: row.row_number, file_id: row.file_id, qty, unit_price: unitPrice },
          severity: Math.abs(expected - totalSales) > Math.max(1, expected * 0.1) ? 'error' : 'warning',
        })
      }
    }

    if (totalSales != null && vendorDue != null && commission != null) {
      const expected = Math.round((vendorDue + commission) * 100) / 100
      if (Math.abs(expected - totalSales) > TOLERANCE) {
        discrepancies.push({
          entity_type: 'sales',
          category: 'vendor_due_plus_commission_mismatch',
          expected_value: expected,
          actual_value: totalSales,
          difference: Math.round((totalSales - expected) * 100) / 100,
          details: { row_number: row.row_number, file_id: row.file_id, vendor_due: vendorDue, commission_amount: commission },
          severity: 'warning',
        })
      }
    }
  }

  if (salesRows.length > 0) {
    discrepancies.push({
      entity_type: 'sales',
      category: 'expected_sales_total',
      expected_value: Math.round(expectedSalesTotal * 100) / 100,
      actual_value: Math.round(actualSalesTotal * 100) / 100,
      difference: Math.round((actualSalesTotal - expectedSalesTotal) * 100) / 100,
      details: { rows_checked: salesRows.length, rows_mismatched: mismatchedRows },
      severity: mismatchedRows > 0 ? 'warning' : 'info',
    })
  }

  const { rows: payoutRows } = await pool.query(
    `SELECT id, row_number, file_id, normalized_data, corrections
     FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'payouts'
       AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
    [migrationId]
  )
  for (const row of payoutRows) {
    const d = { ...(row.normalized_data as object), ...(row.corrections as object) } as Record<string, unknown>
    const paid = num(d.amount_paid ?? d.amount)
    const due = num(d.amount_due)
    if (paid != null && due != null && Math.abs(paid - due) > TOLERANCE) {
      discrepancies.push({
        entity_type: 'payouts',
        category: 'amount_paid_vs_due_mismatch',
        expected_value: due,
        actual_value: paid,
        difference: Math.round((paid - due) * 100) / 100,
        details: { row_number: row.row_number, file_id: row.file_id },
        severity: 'warning',
      })
    }
  }

  const { rows: returnsRows } = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM public.migration_staging_rows
     WHERE migration_id = $1 AND entity_type = 'returns'
       AND validation_status IN ('valid','warning','corrected') AND intended_action <> 'skip'`,
    [migrationId]
  )
  if (returnsRows[0]?.c > 0) {
    discrepancies.push({
      entity_type: 'returns',
      category: 'expected_returns_count',
      expected_value: returnsRows[0].c,
      actual_value: returnsRows[0].c,
      difference: 0,
      details: { rows_checked: returnsRows[0].c },
      severity: 'info',
    })
  }

  return discrepancies
}

/** Persist discrepancies (replacing any prior run for this migration) and return them. */
export async function refreshFinancialDiscrepancies(
  pool: Pool,
  migrationId: string
): Promise<FinancialDiscrepancy[]> {
  const discrepancies = await computeFinancialIntegrityChecks(pool, migrationId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM public.migration_financial_discrepancies WHERE migration_id = $1`, [migrationId])
    for (const d of discrepancies) {
      await client.query(
        `INSERT INTO public.migration_financial_discrepancies
          (migration_id, entity_type, category, expected_value, actual_value, difference, details, severity)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [migrationId, d.entity_type, d.category, d.expected_value, d.actual_value, d.difference, JSON.stringify(d.details), d.severity]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return discrepancies
}
