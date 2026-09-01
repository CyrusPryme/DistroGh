/** Present database strings (often ALL CAPS) in readable title case. */
export function formatDisplayName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return '—'
  const letters = s.replace(/[^a-zA-Z]/g, '')
  if (letters.length >= 3 && letters === letters.toUpperCase()) {
    return s
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }
  return s
}
