/**
 * Green Chilli 600G: remove erroneous 2025-08-02 intake (6) and matching next delivery (2025-09-01, 6).
 * WH unchanged (recv/del both -6); Spintex shelf -6; sales/returns untouched.
 *
 *   npx tsx -r dotenv/config scripts/apply-green-chilli-600-0802-pair-remove.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/apply-green-chilli-600-0802-pair-remove.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const REF = 'admin-correction:green-chilli-600-2025-08-02-paired-remove'
const INTAKE_ID = 'fd090b78-b521-4ed2-805c-95f9cf22a71e'
const DELIVERY_RUN_ID = '2a104bfa-5662-4d61-83d9-926d47886861'
const DELIVERY_ITEM_ID = '7a578116-3462-4d96-9d4a-4b45637a16c4'
const QTY = 6

const apply = process.argv.includes('--apply')

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const client = await pool.connect()
  try {
    const { rows: p } = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE name = 'AUNTY LULUS GREEN CHILLI 600G' AND deleted_at IS NULL`
    )
    const productId = p[0]?.id
    if (!productId) throw new Error('Product not found')

    const { rows: intake } = await client.query<{ quantity_received: number; received_date: string }>(
      `SELECT quantity_received, received_date::text FROM intakes WHERE id = $1::uuid AND deleted_at IS NULL`,
      [INTAKE_ID]
    )
    if (!intake[0] || intake[0].quantity_received !== QTY || !intake[0].received_date.startsWith('2025-08-02')) {
      throw new Error('Intake 2025-08-02×6 missing or already removed')
    }

    const { rows: delItem } = await client.query<{ quantity_delivered: number; delivery_date: string }>(
      `SELECT dri.quantity_delivered, dr.delivery_date::text
       FROM delivery_run_items dri
       JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
       WHERE dri.id = $1::uuid AND dr.id = $2::uuid AND dri.product_id = $3::uuid`,
      [DELIVERY_ITEM_ID, DELIVERY_RUN_ID, productId]
    )
    if (!delItem[0] || delItem[0].quantity_delivered !== QTY || !delItem[0].delivery_date.startsWith('2025-09-01')) {
      throw new Error('Delivery 2025-09-01×6 missing or already changed')
    }

    const before = await chain(client, productId, spintexId)
    const afterRecv = before.received - QTY
    const afterDel = before.delivered - QTY
    const afterShelf = Math.max(0, before.shelf - QTY)

    console.log('Before', before)
    console.log('After (planned)', {
      received: afterRecv,
      delivered: afterDel,
      wh: afterRecv - afterDel,
      shelf: afterShelf,
      soldSp: before.soldSp,
      retSp: before.retSp,
    })

    if (!apply) {
      console.log('\nDry run — re-run with --apply')
      return
    }

    await client.query('BEGIN')

    await client.query(
      `UPDATE intakes SET deleted_at = now(), reference = COALESCE(NULLIF(reference, ''), $2)
       WHERE id = $1::uuid AND deleted_at IS NULL`,
      [INTAKE_ID, REF]
    )

    await client.query(
      `UPDATE delivery_runs SET deleted_at = now(), notes = COALESCE(notes, '') || $2
       WHERE id = $1::uuid AND deleted_at IS NULL`,
      [DELIVERY_RUN_ID, ` [${REF}]`]
    )

    const { rows: inv } = await client.query<{ id: string; quantity: number }>(
      `SELECT id, quantity FROM supermarket_inventory
       WHERE supermarket_id = $1::uuid AND product_id = $2::uuid FOR UPDATE`,
      [spintexId, productId]
    )
    if (!inv[0]) throw new Error('No supermarket_inventory row to adjust')
    const newShelf = Math.max(0, Number(inv[0].quantity) - QTY)
    await client.query(`UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`, [
      inv[0].id,
      newShelf,
    ])

    await client.query('COMMIT')
    console.log('\nApplied.', { shelf: `${inv[0].quantity} → ${newShelf}` })

    const after = await chain(client, productId, spintexId)
    console.log('After (verified)', after)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

async function chain(
  client: pg.PoolClient,
  productId: string,
  spintexId: string
): Promise<{ received: number; delivered: number; shelf: number; soldSp: number; retSp: number }> {
  const { rows: r } = await client.query<{ received: number; delivered: number; shelf: number; soldSp: number; retSp: number }>(
    `
    SELECT
      (SELECT COALESCE(SUM(quantity_received),0)::int FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid) AS received,
      (SELECT COALESCE(SUM(dri.quantity_delivered),0)::int FROM delivery_run_items dri
       JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
       WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid) AS delivered,
      COALESCE((SELECT quantity FROM supermarket_inventory WHERE product_id = $1::uuid AND supermarket_id = $2::uuid),0)::int AS shelf,
      (SELECT COALESCE(SUM(qty_sold),0)::int FROM sales WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid) AS "soldSp",
      (SELECT COALESCE(SUM(quantity_returned),0)::int FROM product_returns WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid) AS "retSp"
    `,
    [productId, spintexId]
  )
  return r[0]
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
