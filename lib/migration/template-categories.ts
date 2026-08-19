import type { Pool } from 'pg'

/** Active category names for the products migration template dropdown. */
export async function fetchActiveCategoryNames(db: Pool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT name FROM public.categories WHERE deleted_at IS NULL ORDER BY name ASC`
  )
  return rows.map((r: { name: string }) => String(r.name).trim()).filter(Boolean)
}
