/**
 * Red Chilli 600G: paired remove intake ×8 and next delivery ×8 (WH neutral, shelf −8).
 * Targets 2025-08-02 intake + 2025-10-04 delivery (no 2025-06-27×8 in DB).
 *
 *   npx tsx -r dotenv/config scripts/apply-red-chilli-600-pair-remove.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const REF = 'admin-correction:red-chilli-600-paired-remove-8'
const INTAKE_ID = '413c9774-98ea-4f84-92c9-14686c1b648b'
const DELIVERY_RUN_ID = '29f8414a-c4a5-45c9-af5b-817a008c7e4e'
const DELIVERY_ITEM_ID = '24abc856-bd9c-4ff0-afca-49422db4f43d'
const QTY = 8
const INTAKE_DATE_PREFIX = '2025-08-02'
const DELIVERY_DATE_PREFIX = '2025-10-04'

const apply = process.argv.includes('--apply')

async function chain(client: pg.PoolClient, productId: string, spintexId: string) {
  const { rows } = await client.query<{
    received: number
    delivered: number
    shelf: number
    soldSp: number
    retSp: number
  }>(
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
  return rows[0]
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const spintexId = await resolvePalaceSpintexId(pool)
  if (!spintexId) throw new Error('Palace Spintex not found')

  const client = await pool.connect()
  try {
    const { rows: p } = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE name = 'AUNTY LULUS RED CHILLI 600G' AND deleted_at IS NULL`
    )
    const productId = p[0]?.id
    if (!productId) throw new Error('Product not found')

    const { rows: intake } = await client.query<{ quantity_received: number; received_date: string }>(
      `SELECT quantity_received, received_date::text FROM intakes WHERE id = $1::uuid AND deleted_at IS NULL`,
      [INTAKE_ID]
    )
    if (
      !intake[0] ||
      intake[0].quantity_received !== QTY ||
      !intake[0].received_date.startsWith(INTAKE_DATE_PREFIX)
    ) {
      throw new Error(`Expected intake ${INTAKE_DATE_PREFIX}×${QTY}`)
    }

    const { rows: delItem } = await client.query<{ quantity_delivered: number; delivery_date: string }>(
      `SELECT dri.quantity_delivered, dr.delivery_date::text
       FROM delivery_run_items dri
       JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
       WHERE dri.id = $1::uuid AND dr.id = $2::uuid AND dri.product_id = $3::uuid`,
      [DELIVERY_ITEM_ID, DELIVERY_RUN_ID, productId]
    )
    if (
      !delItem[0] ||
      delItem[0].quantity_delivered !== QTY ||
      !delItem[0].delivery_date.startsWith(DELIVERY_DATE_PREFIX)
    ) {
      throw new Error(`Expected delivery ${DELIVERY_DATE_PREFIX}×${QTY}`)
    }

    const before = await chain(client, productId, spintexId)
    console.log('Before', before)
    console.log('Planned', {
      received: before.received - QTY,
      delivered: before.delivered - QTY,
      wh: before.received - before.delivered,
      shelf: before.shelf - QTY,
      soldSp: before.soldSp,
      retSp: before.retSp,
    })

    if (!apply) {
      console.log('Dry run — use --apply')
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
    if (!inv[0]) throw new Error('No inventory row')
    const newShelf = Math.max(0, Number(inv[0].quantity) - QTY)
    await client.query(`UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`, [
      inv[0].id,
      newShelf,
    ])
    await client.query('COMMIT')
    console.log('Applied shelf', inv[0].quantity, '→', newShelf)
    console.log('After', await chain(client, productId, spintexId))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
