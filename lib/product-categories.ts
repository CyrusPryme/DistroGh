/** Merge category name lists (settings, products, current value) for dropdown options. */
export function mergeCategoryOptions(
  ...sources: Array<Array<string | null | undefined> | string | null | undefined>
): string[] {
  const set = new Set<string>()
  for (const source of sources) {
    if (!source) continue
    if (typeof source === 'string') {
      const trimmed = source.trim()
      if (trimmed) set.add(trimmed)
      continue
    }
    if (!Array.isArray(source)) continue
    for (const item of source) {
      const trimmed = item?.trim()
      if (trimmed) set.add(trimmed)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Case-insensitive lookup so "Beverages" matches stored "beverages". */
export function resolveCategoryOption(
  options: string[],
  value: string | null | undefined
): string | null {
  const norm = value?.trim().toLowerCase()
  if (!norm) return null
  return options.find((c) => c.toLowerCase() === norm) ?? null
}
