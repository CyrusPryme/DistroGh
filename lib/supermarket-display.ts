/** Display label for a supermarket (includes branch when set). */
export function formatSupermarketLabel(
  sm: { name: string; branch?: string | null; location?: string | null }
): string {
  const name = sm.name?.trim() ?? ''
  const branch = sm.branch?.trim()
  if (branch) return `${name} — ${branch}`
  return name
}
