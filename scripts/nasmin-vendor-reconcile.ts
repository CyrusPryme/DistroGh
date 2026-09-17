/**
 * One-off NASMIN vendor chain breakdown (read-only).
 * Usage: npx tsx -r dotenv/config scripts/nasmin-vendor-reconcile.ts dotenv_config_path=.env.local
 */
import 'dotenv/config'
import pg from 'pg'

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const { rows: vendors } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM vendors WHERE deleted_at IS NULL AND lower(name) LIKE '%nasmin%' LIMIT 5`
  )
  if (!vendors[0]) throw new Error('NASMIN vendor not found')
  const vid = vendors[0].id
  console.log('Vendor:', vendors[0].name)

  const { rows: sp } = await pool.query<{ id: string }>(
    `SELECT id FROM supermarkets
     WHERE deleted_at IS NULL AND lower(name) = 'palace' AND lower(coalesce(branch, '')) = 'spintex'
     LIMIT 1`
  )
  const spintexId = sp[0]?.id ?? null

  const { rows } = await pool.query<{
    name: string
    barcode: string | null
    received: number
    delivered_all: number
    delivered_spintex: number
    delivered_palace_chain: number
    sold_all: number
    sold_spintex: number
    returns_all: number
    wh_on_hand: number
    store_gap_all: number
    store_gap_spintex: number
  }>(
    `
    WITH p AS (
      SELECT id, name, barcode FROM products WHERE deleted_at IS NULL AND vendor_id = $1::uuid
    ),
    rec AS (
      SELECT product_id, SUM(quantity_received)::int q FROM intakes WHERE deleted_at IS NULL GROUP BY product_id
    ),
    del AS (
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int q
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      GROUP BY dri.product_id
    ),
    del_sp AS (
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int q
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      WHERE dr.supermarket_id = $2::uuid
      GROUP BY dri.product_id
    ),
    del_palace AS (
      SELECT dri.product_id, SUM(dri.quantity_delivered)::int q
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      JOIN supermarkets sm ON sm.id = dr.supermarket_id AND sm.deleted_at IS NULL
      WHERE lower(sm.name) = 'palace'
      GROUP BY dri.product_id
    ),
    sold AS (
      SELECT product_id, SUM(qty_sold)::int q FROM sales WHERE deleted_at IS NULL GROUP BY product_id
    ),
    sold_sp AS (
      SELECT product_id, SUM(qty_sold)::int q
      FROM sales WHERE deleted_at IS NULL AND supermarket_id = $2::uuid
      GROUP BY product_id
    ),
    ret AS (
      SELECT product_id, SUM(quantity_returned)::int q FROM product_returns WHERE deleted_at IS NULL GROUP BY product_id
    )
    SELECT
      p.name,
      p.barcode,
      COALESCE(rec.q, 0) AS received,
      COALESCE(del.q, 0) AS delivered_all,
      COALESCE(del_sp.q, 0) AS delivered_spintex,
      COALESCE(del_palace.q, 0) AS delivered_palace_chain,
      COALESCE(sold.q, 0) AS sold_all,
      COALESCE(sold_sp.q, 0) AS sold_spintex,
      COALESCE(ret.q, 0) AS returns_all,
      GREATEST(0, COALESCE(rec.q, 0) - COALESCE(del.q, 0)) AS wh_on_hand,
      COALESCE(del.q, 0) - COALESCE(sold.q, 0) + COALESCE(ret.q, 0) AS store_gap_all,
      COALESCE(del_sp.q, 0) - COALESCE(sold_sp.q, 0) + COALESCE(ret.q, 0) AS store_gap_spintex
    FROM p
    LEFT JOIN rec ON rec.product_id = p.id
    LEFT JOIN del ON del.product_id = p.id
    LEFT JOIN del_sp ON del_sp.product_id = p.id
    LEFT JOIN del_palace ON del_palace.product_id = p.id
    LEFT JOIN sold ON sold.product_id = p.id
    LEFT JOIN sold_sp ON sold_sp.product_id = p.id
    LEFT JOIN ret ON ret.product_id = p.id
    WHERE COALESCE(rec.q, 0) + COALESCE(del.q, 0) + COALESCE(sold.q, 0) + COALESCE(ret.q, 0) > 0
    ORDER BY ABS(COALESCE(del.q, 0) - COALESCE(sold.q, 0) + COALESCE(ret.q, 0)) DESC, p.name
    `,
    [vid, spintexId]
  )

  type Row = (typeof rows)[0]
  const sum = (k: keyof Row) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)

  console.log('\n=== TOTALS (matches vendor flow all-time scope) ===')
  console.log({
    received: sum('received'),
    delivered_all: sum('delivered_all'),
    delivered_spintex: sum('delivered_spintex'),
    delivered_palace_chain: sum('delivered_palace_chain'),
    sold_all: sum('sold_all'),
    sold_spintex: sum('sold_spintex'),
    returns_all: sum('returns_all'),
    wh_on_hand: sum('wh_on_hand'),
    store_gap_all: sum('store_gap_all'),
    store_gap_spintex: sum('store_gap_spintex'),
  })
  console.log('store_gap = delivered - sold + returns (negative = sold more than delivered)')

  console.log('\n=== Per product (non-zero store gap, all outlets) ===')
  for (const r of rows.filter((x) => Number(x.store_gap_all) !== 0)) {
    console.log(
      [
        (r.name ?? '').slice(0, 44),
        `recv=${r.received}`,
        `del=${r.delivered_all}`,
        `palace=${r.delivered_palace_chain}`,
        `spintex=${r.delivered_spintex}`,
        `sold=${r.sold_all}`,
        `soldSp=${r.sold_spintex}`,
        `ret=${r.returns_all}`,
        `gap=${r.store_gap_all}`,
      ].join(' | ')
    )
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
