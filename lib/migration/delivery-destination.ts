import type { PoolClient, Pool } from 'pg'

export type DeliveryDestinationType = 'BRANCH' | 'WAREHOUSE' | 'DISTRIBUTION_POINT' | 'UNKNOWN_HISTORICAL'

export interface ResolvedDeliveryDestination {
  destinationType: DeliveryDestinationType
  supermarketId: string | null
  /** Free-text label for non-BRANCH destinations — never a fabricated branch. */
  destinationReference: string | null
  /** True when the source row actually supplied branch text that could not be matched to a real branch. */
  branchTextProvidedButUnmatched: boolean
}

function s(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

const KNOWN_TYPES: DeliveryDestinationType[] = ['BRANCH', 'WAREHOUSE', 'DISTRIBUTION_POINT', 'UNKNOWN_HISTORICAL']

function normalizeExplicitType(raw: unknown): DeliveryDestinationType | null {
  const v = s(raw).toUpperCase().replace(/[\s-]+/g, '_')
  return (KNOWN_TYPES as string[]).includes(v) ? (v as DeliveryDestinationType) : null
}

/**
 * Resolve where a historical delivery row actually went, without ever fabricating a
 * supermarket/branch record to satisfy a foreign key.
 *
 * Rules:
 *  - If supermarket_name (+ optional branch) matches a real supermarket -> BRANCH.
 *  - Else if the row explicitly says destination_type = WAREHOUSE/DISTRIBUTION_POINT and
 *    supplies a destination_reference/warehouse name -> use that type + reference.
 *  - Else if a supermarket_name was supplied but did not match anything real -> treat the
 *    supplied name as a WAREHOUSE/DISTRIBUTION_POINT reference (never invent a branch row).
 *  - Else -> UNKNOWN_HISTORICAL (still accepted, still traceable, always a WARNING).
 */
export async function resolveDeliveryDestination(
  db: Pool | PoolClient,
  data: Record<string, unknown>
): Promise<ResolvedDeliveryDestination> {
  const supermarketName = s(data.supermarket_name || data.name || data.store)
  const branch = s(data.branch)
  const explicitType = normalizeExplicitType(data.destination_type)
  const destinationReferenceRaw = s(data.destination_reference || data.warehouse_name || data.warehouse)

  if (supermarketName) {
    const match = await db.query(
      `SELECT id FROM public.supermarkets
       WHERE deleted_at IS NULL AND lower(name) = lower($1)
         AND lower(coalesce(branch,'')) = lower($2) LIMIT 1`,
      [supermarketName, branch]
    )
    if (match.rows[0]) {
      return {
        destinationType: 'BRANCH',
        supermarketId: match.rows[0].id,
        destinationReference: null,
        branchTextProvidedButUnmatched: false,
      }
    }
  }

  if (explicitType && explicitType !== 'BRANCH') {
    return {
      destinationType: explicitType,
      supermarketId: null,
      destinationReference: destinationReferenceRaw || supermarketName || null,
      branchTextProvidedButUnmatched: Boolean(branch),
    }
  }

  if (destinationReferenceRaw) {
    return {
      destinationType: 'WAREHOUSE',
      supermarketId: null,
      destinationReference: destinationReferenceRaw,
      branchTextProvidedButUnmatched: Boolean(branch),
    }
  }

  if (supermarketName) {
    // Named destination that isn't a matchable supermarket row — accept it as a
    // historical warehouse/distribution reference instead of fabricating a branch.
    return {
      destinationType: 'WAREHOUSE',
      supermarketId: null,
      destinationReference: supermarketName,
      branchTextProvidedButUnmatched: Boolean(branch),
    }
  }

  return {
    destinationType: 'UNKNOWN_HISTORICAL',
    supermarketId: null,
    destinationReference: null,
    branchTextProvidedButUnmatched: false,
  }
}
