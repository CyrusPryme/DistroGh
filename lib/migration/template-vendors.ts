import type { Pool } from 'pg'

/** Active vendor names for migration template dropdowns (fresh on each download). */
export async function fetchActiveVendorNames(db: Pool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT name FROM public.vendors WHERE deleted_at IS NULL ORDER BY name ASC`
  )
  return rows.map((r: { name: string }) => String(r.name))
}
