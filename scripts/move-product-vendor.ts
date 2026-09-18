/**
 * Reassign a product (and intakes) to another vendor. Sales/deliveries/returns follow via product_id.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/move-product-vendor.ts dotenv_config_path=.env.local --product-id <uuid> --to-vendor-id <uuid>
 *   add --apply to commit
 */
import 'dotenv/config'
import pg from 'pg'
import { writeAuditLog } from '@/lib/rbac/audit'

const REF = 'admin-correction:product-vendor-reassignment'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const productId = arg('--product-id')
const toVendorId = arg('--to-vendor-id')
const apply = process.argv.includes('--apply')

async function main() {
  if (!productId || !toVendorId) {
    throw new Error('Usage: --product-id <uuid> --to-vendor-id <uuid> [--apply]')
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()

  try {
    const { rows: prod } = await client.query<{
      id: string
      name: string
      barcode: string | null
      vendor_id: string
      vendor_name: string
    }>(
      `SELECT p.id, p.name, p.barcode, p.vendor_id, v.name AS vendor_name
       FROM products p JOIN vendors v ON v.id = p.vendor_id
       WHERE p.id = $1::uuid AND p.deleted_at IS NULL`,
      [productId]
    )
    if (!prod[0]) throw new Error('Product not found')
    const fromVendorId = prod[0].vendor_id

    const { rows: target } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM vendors WHERE id = $1::uuid AND deleted_at IS NULL`,
      [toVendorId]
    )
    if (!target[0]) throw new Error('Target vendor not found')
    if (fromVendorId === toVendorId) throw new Error('Product already on target vendor')

    const { rows: barcodeClash } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM products
       WHERE deleted_at IS NULL AND vendor_id = $1::uuid AND id <> $2::uuid
         AND barcode IS NOT NULL AND barcode = $3`,
      [toVendorId, productId, prod[0].barcode]
    )
    if (barcodeClash.length) {
      throw new Error(`Target vendor already has product with barcode ${prod[0].barcode}: ${barcodeClash[0].name}`)
    }

    const { rows: before } = await client.query<{
      intakes: number
      sales: number
      returns: number
      deliveries: number
    }>(
      `
      SELECT
        (SELECT COUNT(*)::int FROM intakes WHERE deleted_at IS NULL AND product_id = $1::uuid) AS intakes,
        (SELECT COUNT(*)::int FROM sales WHERE deleted_at IS NULL AND product_id = $1::uuid) AS sales,
        (SELECT COUNT(*)::int FROM product_returns WHERE deleted_at IS NULL AND product_id = $1::uuid) AS returns,
        (SELECT COUNT(*)::int FROM delivery_run_items dri
          JOIN delivery_runs dr ON dr.id = dri.delivery_run_id AND dr.deleted_at IS NULL
          WHERE dri.product_id = $1::uuid) AS deliveries
      `,
      [productId]
    )

    const { rows: deductions } = await client.query<{ id: string; amount: string }>(
      `SELECT vd.id, vd.amount::text FROM vendor_deductions vd
       JOIN product_returns pr ON pr.id = vd.reference_id AND vd.reference_type = 'return'
       WHERE pr.product_id = $1::uuid`,
      [productId]
    )

    console.log('Move plan:', {
      product: prod[0].name,
      barcode: prod[0].barcode,
      from: prod[0].vendor_name,
      to: target[0].name,
      linked: before[0],
      return_deductions_on_old_vendor: deductions,
    })

    if (!apply) {
      console.log('\nDry run — re-run with --apply')
      return
    }

    await client.query('BEGIN')

    const { rowCount: pUpd } = await client.query(
      `UPDATE products SET vendor_id = $2::uuid, updated_at = now() WHERE id = $1::uuid AND deleted_at IS NULL`,
      [productId, toVendorId]
    )
    if (pUpd !== 1) throw new Error('Product update failed')

    const { rowCount: iUpd } = await client.query(
      `UPDATE intakes SET vendor_id = $2::uuid
       WHERE product_id = $1::uuid AND deleted_at IS NULL AND vendor_id = $3::uuid`,
      [productId, toVendorId, fromVendorId]
    )

    // Return-linked deductions should follow the product's vendor for balance views.
    if (deductions.length) {
      await client.query(
        `UPDATE vendor_deductions vd SET vendor_id = $2::uuid
         FROM product_returns pr
         WHERE pr.id = vd.reference_id AND vd.reference_type = 'return'
           AND pr.product_id = $1::uuid AND vd.vendor_id = $3::uuid`,
        [productId, toVendorId, fromVendorId]
      )
    }

    const { rows: dev } = await client.query<{ id: string }>(
      `SELECT u.id FROM users u
       JOIN admin_profiles ap ON ap.user_id = u.id
       WHERE ap.admin_role IN ('developer', 'super_admin')
       ORDER BY CASE ap.admin_role WHEN 'developer' THEN 0 ELSE 1 END LIMIT 1`
    )
    const actorId = dev[0]?.id
    if (actorId) {
      await writeAuditLog(client, {
        actor_id: actorId,
        action: 'product.vendor_reassigned',
        module: 'products',
        target_id: productId,
        metadata: {
          reference: REF,
          product_name: prod[0].name,
          from_vendor_id: fromVendorId,
          to_vendor_id: toVendorId,
          intakes_updated: iUpd,
        },
      })
    }

    await client.query('COMMIT')
    console.log('\nApplied.', { intakes_updated: iUpd })
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
