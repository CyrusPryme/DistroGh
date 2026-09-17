/**
 * After intake corrections, Lulu supplemental deliveries (migration 95e98047) are oversized.
 * Trim those run item qtys so delivered = received per SKU; set Spintex shelf from formula only.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/reconcile-nasmin-deliveries-to-intakes.ts dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/reconcile-nasmin-deliveries-to-intakes.ts dotenv_config_path=.env.local --apply
 */
import 'dotenv/config'
import pg from 'pg'
import { resolvePalaceSpintexId } from '@/lib/migration/stock-chain-data'

const LULU_MIGRATION = '95e98047-510b-4a2b-997c-0f2cc83b6cf5'
const REF = 'admin-correction:nasmin-deliveries-match-intakes-post-intake-fix'

/** Lulu migration run item adjustments (delivery_date preserved on run). */
const ITEM_QTY: { runId: string; productName: string; newQty: number }[] = [
  { runId: '7247c0fb-f8bd-4328-9ebd-cce1dd279c0a', productName: 'AUNTY LULUS GREEN CHILLI 200G', newQty: 58 },
  { runId: 'fb9bbd06-167d-4f29-8924-e9654b74208f', productName: 'AUNTY LULUS GREEN CHILLI 600G', newQty: 17 },
  { runId: '9d2deae1-df66-494a-9337-042541b634f5', productName: 'AUNTY LULUS RED CHILLI 200G', newQty: 68 },
  { runId: '8e473085-58e8-4217-ae09-aed75d7d6379', productName: 'AUNTY LULUS SHITO 200G', newQty: 55 },
  { runId: 'be51d3d4-f2fd-4f47-8818-29e4c3c660f4', productName: 'AUNTY LULUS SHITO 600G', newQty: 12 },
]

const apply = process.argv.includes('--apply')

async function chain(
  client: pg.PoolClient,
  productId: string,
  spintexId: string
): Promise<{ received: number; delivered: number; sold: number; returned: number; inventory: number }> {
  const { rows } = await client.query<{
    received: number
    delivered: number
    sold: number
    returned: number
    inventory: number
  }>(
    `
    WITH r AS (
      SELECT COALESCE(SUM(quantity_received),0)::int q FROM intakes
      WHERE deleted_at IS NULL AND product_id = $1::uuid
    ),
    d AS (
      SELECT COALESCE(SUM(dri.quantity_delivered),0)::int q
      FROM delivery_run_items dri
      JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
      WHERE dri.product_id = $1::uuid AND dr.supermarket_id = $2::uuid
    ),
    s AS (
      SELECT COALESCE(SUM(qty_sold),0)::int q FROM sales
      WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid
    ),
    ret AS (
      SELECT COALESCE(SUM(quantity_returned),0)::int q FROM product_returns
      WHERE deleted_at IS NULL AND product_id = $1::uuid AND supermarket_id = $2::uuid
    ),
    inv AS (
      SELECT COALESCE(quantity,0)::int q FROM supermarket_inventory
      WHERE product_id = $1::uuid AND supermarket_id = $2::uuid
    )
    SELECT r.q AS received, d.q AS delivered, s.q AS sold, ret.q AS returned,
           COALESCE((SELECT q FROM inv), 0) AS inventory
    FROM r, d, s, ret
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
  const lines: string[] = []

  try {
    if (apply) await client.query('BEGIN')

    for (const spec of ITEM_QTY) {
      const { rows: prods } = await client.query<{ id: string }>(
        `SELECT id FROM products WHERE deleted_at IS NULL AND name = $1 LIMIT 1`,
        [spec.productName]
      )
      const productId = prods[0]?.id
      if (!productId) throw new Error(`Product not found: ${spec.productName}`)

      const { rows: items } = await client.query<{ id: string; qty: number; run_notes: string | null }>(
        `SELECT dri.id, dri.quantity_delivered AS qty, dr.notes AS run_notes
         FROM delivery_run_items dri
         JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
         WHERE dr.id = $1::uuid AND dri.product_id = $2::uuid`,
        [spec.runId, productId]
      )
      if (items.length !== 1) throw new Error(`Expected 1 item on run ${spec.runId}, got ${items.length}`)
      const item = items[0]
      if (!String(item.run_notes ?? '').includes(LULU_MIGRATION)) {
        throw new Error(`Run ${spec.runId} is not Lulu migration ${LULU_MIGRATION}`)
      }

      const before = await chain(client, productId, spintexId)
      const delta = spec.newQty - item.qty

      if (item.qty === spec.newQty) {
        lines.push(`${spec.productName}: Lulu item already qty=${spec.newQty}`)
        continue
      }

      if (apply) {
        await client.query(
          `UPDATE delivery_run_items SET quantity_delivered = $1 WHERE id = $2::uuid`,
          [spec.newQty, item.id]
        )
        await client.query(
          `UPDATE delivery_runs SET notes = COALESCE(notes,'') || $2 WHERE id = $1::uuid`,
          [spec.runId, ` [${REF}]`]
        )
      }

      const afterDelivered = before.delivered + delta
      const targetInv = Math.max(0, afterDelivered - before.sold - before.returned)

      if (apply) {
        const { rows: inv } = await client.query<{ id: string }>(
          `SELECT id FROM supermarket_inventory WHERE supermarket_id = $1::uuid AND product_id = $2::uuid FOR UPDATE`,
          [spintexId, productId]
        )
        if (inv[0]) {
          await client.query(`UPDATE supermarket_inventory SET quantity = $2, updated_at = now() WHERE id = $1::uuid`, [
            inv[0].id,
            targetInv,
          ])
        } else if (targetInv > 0) {
          await client.query(
            `INSERT INTO supermarket_inventory (supermarket_id, product_id, quantity) VALUES ($1::uuid, $2::uuid, $3)`,
            [spintexId, productId, targetInv]
          )
        }
      }

      lines.push(
        `${spec.productName}: item ${item.qty}→${spec.newQty}, delivered ${before.delivered}→${afterDelivered}, recv=${before.received}, WH=${Math.max(0, before.received - afterDelivered)}, shelf ${before.inventory}→${targetInv}`
      )
    }

    if (apply) await client.query('COMMIT')
  } catch (e) {
    if (apply) await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }

  console.log(apply ? 'APPLIED' : 'DRY RUN')
  lines.forEach((l) => console.log(' ', l))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
