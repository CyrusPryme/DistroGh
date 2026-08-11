import type { PoolClient, Pool } from 'pg'

export type CategoryChangeOutcome =
  | 'unchanged'          // A. same category (case/whitespace-insensitive) -> no change
  | 'populated'          // B. existing NULL + incoming exists -> populate
  | 'overridden'         // C. existing exists + incoming differs -> historical migration overrides
  | 'preserved'          // D. incoming missing -> keep existing category as-is
  | 'unmatchable'        // E. incoming cannot be matched/created -> caller must warn/error

export interface CategoryChangeResult {
  outcome: CategoryChangeOutcome
  /** Category value that should be written to products.category (null = leave column untouched). */
  resolvedCategory: string | null
  previousCategory: string | null
  incomingCategoryRaw: string | null
  /** True when a brand-new categories catalogue row was created for this value. */
  createdNewCategory: boolean
}

/** Collapse whitespace + case so "Drinks" / "drinks" / " Drinks " / "DRINKS" never create duplicates. */
export function normalizeCategoryName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Resolve an incoming category value against the existing `categories` catalogue.
 * Match order: exact id -> exact name -> normalized name -> case-insensitive -> trimmed whitespace.
 * (Name-based matches are effectively the same normalized comparison; id is checked first
 * because it is the least ambiguous signal when the source spreadsheet supplies one.)
 */
export async function matchCategory(
  db: Pool | PoolClient,
  incoming: { categoryId?: string | null; categoryName?: string | null }
): Promise<{ id: string; name: string } | null> {
  if (incoming.categoryId) {
    const byId = await db.query(
      `SELECT id, name FROM public.categories WHERE id = $1::uuid LIMIT 1`,
      [incoming.categoryId]
    )
    if (byId.rows[0]) return byId.rows[0]
  }
  const raw = (incoming.categoryName ?? '').trim()
  if (!raw) return null

  const exact = await db.query(
    `SELECT id, name FROM public.categories WHERE name = $1 LIMIT 1`,
    [raw]
  )
  if (exact.rows[0]) return exact.rows[0]

  const normalized = normalizeCategoryName(raw)
  const fuzzy = await db.query(
    `SELECT id, name FROM public.categories WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = $1 LIMIT 1`,
    [normalized]
  )
  if (fuzzy.rows[0]) return fuzzy.rows[0]

  return null
}

/**
 * Compare an existing product's category against an incoming historical value and decide
 * the outcome per the Historical Migration Engine's category rules. Never returns a
 * resolvedCategory of null when the existing category was valid (rule: never replace a
 * valid category with NULL merely because the incoming row has none).
 */
export async function resolveCategoryChange(
  db: Pool | PoolClient,
  params: {
    existingCategory: string | null
    incomingCategoryRaw: string | null
    /** When true (default for historical migration), create a new category row if no match is found. */
    allowNewCategoryCreation?: boolean
  }
): Promise<CategoryChangeResult> {
  const existing = params.existingCategory?.trim() || null
  const incomingRaw = params.incomingCategoryRaw?.trim() || null

  // D. Incoming missing -> preserve existing category untouched.
  if (!incomingRaw) {
    return {
      outcome: 'preserved',
      resolvedCategory: existing,
      previousCategory: existing,
      incomingCategoryRaw: null,
      createdNewCategory: false,
    }
  }

  // A. Same category (normalized) -> no change.
  if (existing && normalizeCategoryName(existing) === normalizeCategoryName(incomingRaw)) {
    return {
      outcome: 'unchanged',
      resolvedCategory: existing,
      previousCategory: existing,
      incomingCategoryRaw: incomingRaw,
      createdNewCategory: false,
    }
  }

  const match = await matchCategory(db, { categoryName: incomingRaw })
  let resolvedName = match?.name ?? null
  let createdNewCategory = false

  if (!resolvedName) {
    if (params.allowNewCategoryCreation === false) {
      // E. Cannot match and creation not permitted -> caller must raise a warning/error
      // and leave the existing category untouched (never null it out).
      return {
        outcome: existing ? 'unmatchable' : 'unmatchable',
        resolvedCategory: existing,
        previousCategory: existing,
        incomingCategoryRaw: incomingRaw,
        createdNewCategory: false,
      }
    }
    const ins = await db.query(
      `INSERT INTO public.categories (name) VALUES ($1)
       ON CONFLICT (LOWER(name)) DO NOTHING
       RETURNING name`,
      [incomingRaw]
    )
    if (ins.rows[0]) {
      resolvedName = ins.rows[0].name
      createdNewCategory = true
    } else {
      // Lost a race with a concurrent insert of the same (normalized) name — re-fetch.
      const again = await matchCategory(db, { categoryName: incomingRaw })
      resolvedName = again?.name ?? incomingRaw
    }
  }

  // B. Existing NULL + incoming resolves -> populate.
  if (!existing) {
    return {
      outcome: 'populated',
      resolvedCategory: resolvedName,
      previousCategory: null,
      incomingCategoryRaw: incomingRaw,
      createdNewCategory,
    }
  }

  // C. Existing exists + incoming differs -> historical migration may auto-override.
  return {
    outcome: 'overridden',
    resolvedCategory: resolvedName,
    previousCategory: existing,
    incomingCategoryRaw: incomingRaw,
    createdNewCategory,
  }
}
