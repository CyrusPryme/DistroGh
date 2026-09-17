import type { Pool } from 'pg'

export type StockTimelineEventKind = 'intake' | 'delivery' | 'sale' | 'return'

export type StockTimelineEvent = {
  kind: StockTimelineEventKind
  /** ISO date used for sorting (sale uses week_start). */
  sort_date: string
  end_date: string | null
  quantity: number
  reference: string | null
  destination: string | null
  record_id: string
}

export type StockTimelineSummary = {
  received: number
  delivered: number
  sold: number
  returns: number
  warehouse_on_hand: number
  delivery_minus_sold_plus_returns: number
}

export async function fetchStockTimeline(
  pool: Pool,
  productId: string,
  rangeStart: string | null,
  rangeEnd: string | null
): Promise<{ events: StockTimelineEvent[]; summary: StockTimelineSummary }> {
  const [intakes, deliveries, sales, returns, totals] = await Promise.all([
    pool.query<{
      id: string
      received_date: string
      quantity_received: number
      reference: string | null
    }>(
      `
      SELECT id, received_date::text, quantity_received, reference
      FROM intakes
      WHERE deleted_at IS NULL AND product_id = $1::uuid
        AND ($2::date IS NULL OR received_date >= $2::date)
        AND ($3::date IS NULL OR received_date <= $3::date)
      ORDER BY received_date, created_at
      `,
      [productId, rangeStart, rangeEnd]
    ),
    pool.query<{
      id: string
      delivery_date: string
      quantity_delivered: number
      supermarket_name: string
      branch: string | null
      run_id: string
    }>(
      `
      SELECT dri.id, dr.delivery_date::text, dri.quantity_delivered,
             sm.name AS supermarket_name, sm.branch, dr.id AS run_id
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      JOIN supermarkets sm ON sm.id = dr.supermarket_id
      WHERE dri.product_id = $1::uuid
        AND ($2::date IS NULL OR dr.delivery_date >= $2::date)
        AND ($3::date IS NULL OR dr.delivery_date <= $3::date)
      ORDER BY dr.delivery_date, dr.created_at
      `,
      [productId, rangeStart, rangeEnd]
    ),
    pool.query<{
      id: string
      week_start: string
      week_end: string
      qty_sold: number
      supermarket_name: string
      branch: string | null
      supermarket_paid: boolean
    }>(
      `
      SELECT s.id, s.week_start::text, s.week_end::text, s.qty_sold,
             sm.name AS supermarket_name, sm.branch, s.supermarket_paid
      FROM sales s
      JOIN supermarkets sm ON sm.id = s.supermarket_id
      WHERE s.deleted_at IS NULL AND s.product_id = $1::uuid
        AND ($2::date IS NULL OR s.week_end >= $2::date)
        AND ($3::date IS NULL OR s.week_start <= $3::date)
      ORDER BY s.week_start, s.imported_at
      `,
      [productId, rangeStart, rangeEnd]
    ),
    pool.query<{
      id: string
      return_date: string
      quantity_returned: number
      supermarket_name: string
      branch: string | null
    }>(
      `
      SELECT r.id, r.return_date::text, r.quantity_returned,
             sm.name AS supermarket_name, sm.branch
      FROM product_returns r
      LEFT JOIN supermarkets sm ON sm.id = r.supermarket_id
      WHERE r.deleted_at IS NULL AND r.product_id = $1::uuid
        AND ($2::date IS NULL OR r.return_date >= $2::date)
        AND ($3::date IS NULL OR r.return_date <= $3::date)
      ORDER BY r.return_date, r.created_at
      `,
      [productId, rangeStart, rangeEnd]
    ),
    pool.query<{
      received: number
      delivered: number
      sold: number
      returns: number
    }>(
      `
      WITH rec AS (
        SELECT COALESCE(SUM(quantity_received), 0)::int q FROM intakes
        WHERE deleted_at IS NULL AND product_id = $1::uuid
          AND ($2::date IS NULL OR received_date >= $2::date)
          AND ($3::date IS NULL OR received_date <= $3::date)
      ),
      del AS (
        SELECT COALESCE(SUM(dri.quantity_delivered), 0)::int q
        FROM delivery_run_items dri
        JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
        WHERE dri.product_id = $1::uuid
          AND ($2::date IS NULL OR dr.delivery_date >= $2::date)
          AND ($3::date IS NULL OR dr.delivery_date <= $3::date)
      ),
      sl AS (
        SELECT COALESCE(SUM(qty_sold), 0)::int q FROM sales s
        WHERE s.deleted_at IS NULL AND s.product_id = $1::uuid
          AND ($2::date IS NULL OR s.week_end >= $2::date)
          AND ($3::date IS NULL OR s.week_start <= $3::date)
      ),
      rt AS (
        SELECT COALESCE(SUM(quantity_returned), 0)::int q FROM product_returns r
        WHERE r.deleted_at IS NULL AND r.product_id = $1::uuid
          AND ($2::date IS NULL OR r.return_date >= $2::date)
          AND ($3::date IS NULL OR r.return_date <= $3::date)
      ),
      wh AS (
        SELECT GREATEST(0,
          (SELECT COALESCE(SUM(quantity_received),0) FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid)
          - (SELECT COALESCE(SUM(dri.quantity_delivered),0) FROM delivery_run_items dri
             JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
             WHERE dri.product_id = $1::uuid)
        )::int AS q
      )
      SELECT rec.q AS received, del.q AS delivered, sl.q AS sold, rt.q AS returns
      FROM rec, del, sl, rt
      `,
      [productId, rangeStart, rangeEnd]
    ),
  ])

  const t = totals.rows[0] ?? { received: 0, delivered: 0, sold: 0, returns: 0 }
  const whRow = await pool.query<{ q: number }>(
    `
    SELECT GREATEST(0,
      (SELECT COALESCE(SUM(quantity_received),0) FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid)
      - (SELECT COALESCE(SUM(dri.quantity_delivered),0) FROM delivery_run_items dri
         JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
         WHERE dri.product_id = $1::uuid)
    )::int AS q
    `,
    [productId]
  )
  const warehouse_on_hand = whRow.rows[0]?.q ?? 0

  const events: StockTimelineEvent[] = []

  for (const row of intakes.rows) {
    events.push({
      kind: 'intake',
      sort_date: row.received_date.slice(0, 10),
      end_date: null,
      quantity: row.quantity_received,
      reference: row.reference,
      destination: 'DistroGH warehouse',
      record_id: row.id,
    })
  }
  for (const row of deliveries.rows) {
    const dest = row.branch ? `${row.supermarket_name} (${row.branch})` : row.supermarket_name
    events.push({
      kind: 'delivery',
      sort_date: row.delivery_date.slice(0, 10),
      end_date: null,
      quantity: row.quantity_delivered,
      reference: `Run ${row.run_id.slice(0, 8)}…`,
      destination: dest,
      record_id: row.id,
    })
  }
  for (const row of sales.rows) {
    const dest = row.branch ? `${row.supermarket_name} (${row.branch})` : row.supermarket_name
    events.push({
      kind: 'sale',
      sort_date: row.week_start.slice(0, 10),
      end_date: row.week_end.slice(0, 10),
      quantity: row.qty_sold,
      reference: row.supermarket_paid ? 'Settled' : 'Unsettled',
      destination: dest,
      record_id: row.id,
    })
  }
  for (const row of returns.rows) {
    const dest = row.supermarket_name
      ? row.branch
        ? `${row.supermarket_name} (${row.branch})`
        : row.supermarket_name
      : '—'
    events.push({
      kind: 'return',
      sort_date: row.return_date.slice(0, 10),
      end_date: null,
      quantity: row.quantity_returned,
      reference: null,
      destination: dest,
      record_id: row.id,
    })
  }

  events.sort((a, b) => a.sort_date.localeCompare(b.sort_date) || a.kind.localeCompare(b.kind))

  const delivered = Number(t.delivered ?? 0)
  const sold = Number(t.sold ?? 0)
  const ret = Number(t.returns ?? 0)

  return {
    events,
    summary: {
      received: Number(t.received ?? 0),
      delivered,
      sold,
      returns: ret,
      warehouse_on_hand,
      delivery_minus_sold_plus_returns: delivered - sold + ret,
    },
  }
}
