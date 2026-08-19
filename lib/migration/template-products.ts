import type { Pool } from 'pg'

/** Active product names for migration template dropdowns (fresh on each download). */
export async function fetchActiveProductNames(db: Pool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT name FROM public.products WHERE deleted_at IS NULL ORDER BY name ASC`
  )
  return rows.map((r: { name: string }) => String(r.name))
}

/** Product barcodes for optional barcode columns on sales/intakes templates. */
export async function fetchActiveProductBarcodes(db: Pool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT barcode FROM public.products
     WHERE deleted_at IS NULL AND coalesce(trim(barcode), '') <> ''
     ORDER BY barcode ASC`
  )
  return rows.map((r: { barcode: string }) => String(r.barcode).trim()).filter(Boolean)
}
