/**
 * Live-operation rule: changing an existing product's category to a different one always
 * requires explicit user confirmation. This must never be weakened by the Historical
 * Migration Engine's automatic-override behaviour (which instead records provenance and
 * skips the interactive popup — see lib/migration/category.ts).
 */
export function normalizeForComparison(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.toLowerCase() : null
}

/**
 * True when the incoming category is a genuine change from a real existing category
 * (not populating a previously-empty one) and the caller has not already confirmed it.
 */
export function requiresLiveCategoryChangeConfirmation(params: {
  existingCategory: string | null | undefined
  incomingCategory: string | null | undefined
  confirmed?: boolean
}): boolean {
  if (params.confirmed === true) return false
  const existing = normalizeForComparison(params.existingCategory)
  const incoming = normalizeForComparison(params.incomingCategory)
  if (existing == null || incoming == null) return false
  return existing !== incoming
}
