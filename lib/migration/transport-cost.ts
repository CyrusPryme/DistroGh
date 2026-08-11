/**
 * Context-aware transport_cost validation. This is the single source of truth for the
 * distinction between:
 *   - source = LIVE_OPERATION      -> transport_cost is REQUIRED (never NULL/empty/undefined).
 *   - source = HISTORICAL_MIGRATION -> transport_cost MAY be NULL ("Not Recorded (Historical)").
 *
 * Both app/api/deliveries/route.ts (live) and lib/migration/writers.ts (historical) must
 * route through helpers here so the rule can never silently drift apart between the two
 * contexts.
 */

export type TransportCostValidation =
  | { ok: true; value: number }
  | { ok: false; error: string }

/**
 * Validate a transport cost value for a LIVE (non-historical) delivery. Rejects NULL,
 * empty string, undefined, non-numeric, and negative values explicitly — 0 is a valid
 * recorded cost, "not provided" is not, so they must never be conflated.
 */
export function validateLiveTransportCost(raw: unknown): TransportCostValidation {
  if (raw == null || raw === '') {
    return { ok: false, error: 'total_transport_cost is required for new deliveries' }
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: 'total_transport_cost must be a non-negative number' }
  }
  return { ok: true, value }
}

/**
 * Resolve a transport cost value for HISTORICAL migration rows. NULL/missing is preserved
 * exactly as NULL ("the historical source did not provide a transport cost") — never
 * coerced to 0, "Unknown", "N/A", or any other invented value.
 */
export function resolveHistoricalTransportCost(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** Display helper for reports/UI — never invents a number for an absent historical value. */
export function formatTransportCostForDisplay(value: number | null, source: 'LIVE_OPERATION' | 'HISTORICAL_MIGRATION'): string {
  if (value == null) {
    return source === 'HISTORICAL_MIGRATION' ? 'Not Recorded (Historical)' : 'Missing'
  }
  return value.toFixed(2)
}
