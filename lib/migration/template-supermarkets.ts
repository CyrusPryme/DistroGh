import type { Pool } from 'pg'

/** Distinct supermarket chain names (deliveries/returns supermarket_name column). */
export async function fetchSupermarketChainNames(db: Pool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT name
     FROM public.supermarkets
     WHERE deleted_at IS NULL
     ORDER BY name ASC`
  )
  return (rows as Array<{ name: string }>)
    .map((r) => String(r.name ?? '').trim())
    .filter(Boolean)
}

/** Branch labels for sales/deliveries migration template dropdowns. */
export async function fetchSupermarketBranchLabels(db: Pool): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT name, branch, store_code
     FROM public.supermarkets
     WHERE deleted_at IS NULL
     ORDER BY name ASC, branch ASC NULLS LAST`
  )
  const typed = rows as Array<{ name: string; branch: string | null; store_code: string | null }>
  const branchCounts = new Map<string, number>()
  for (const r of typed) {
    const b = String(r.branch ?? '').trim()
    if (b) branchCounts.set(b.toLowerCase(), (branchCounts.get(b.toLowerCase()) ?? 0) + 1)
  }
  return typed
    .map((r) => {
      const branch = String(r.branch ?? '').trim()
      const chain = String(r.name ?? '').trim()
      if (!branch) return chain || String(r.store_code ?? '').trim()
      if ((branchCounts.get(branch.toLowerCase()) ?? 0) > 1) {
        return chain ? `${chain} — ${branch}` : branch
      }
      return branch
    })
    .filter(Boolean)
}
