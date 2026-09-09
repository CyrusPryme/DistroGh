/**
 * Human-readable labels for intake reference strings (migration, admin fixes, manual POs).
 */

export type IntakeReferenceTone = 'migration' | 'correction' | 'reconciliation' | 'manual'

export interface IntakeReferenceBadge {
  label: string
  tone: IntakeReferenceTone
  tooltip: string
  isSystemOverride: boolean
}

export type WarehouseStockDiscrepancy = {
  kind: 'over_delivered' | 'delivery_without_intake'
  message: string
}

const TONE_CLASS: Record<IntakeReferenceTone, string> = {
  migration: 'bg-violet-50 text-violet-800 border-violet-200',
  correction: 'bg-amber-50 text-amber-900 border-amber-200',
  reconciliation: 'bg-sky-50 text-sky-900 border-sky-200',
  manual: 'bg-slate-50 text-slate-700 border-slate-200',
}

export function intakeReferenceToneClass(tone: IntakeReferenceTone): string {
  return TONE_CLASS[tone]
}

function truncateId(id: string, len = 8): string {
  const t = id.trim()
  if (t.length <= len) return t
  return `${t.slice(0, len)}…`
}

/** Parse a raw intake reference into a concise badge model. */
export function parseIntakeReference(reference: string | null | undefined): IntakeReferenceBadge | null {
  const raw = reference?.trim()
  if (!raw) return null

  const lower = raw.toLowerCase()

  if (lower.startsWith('migration:')) {
    const id = raw.slice('migration:'.length).trim()
    return {
      label: 'Migration',
      tone: 'migration',
      tooltip: id
        ? `Imported from historical migration (${truncateId(id, 12)})`
        : 'Imported from historical migration',
      isSystemOverride: true,
    }
  }

  if (lower.startsWith('admin-correction:')) {
    const detail = raw.slice('admin-correction:'.length).trim()
    if (detail.includes('stock-chain') || detail.includes('stock')) {
      return {
        label: 'Stock fix',
        tone: 'correction',
        tooltip: 'Admin-confirmed stock-chain correction (intake adjusted to balance warehouse records)',
        isSystemOverride: true,
      }
    }
    if (detail.includes('chronology')) {
      return {
        label: 'Admin fix',
        tone: 'correction',
        tooltip: 'Admin-confirmed intake correction from chronology review',
        isSystemOverride: true,
      }
    }
    return {
      label: 'Admin fix',
      tone: 'correction',
      tooltip: detail ? `Admin correction: ${detail}` : 'Admin-confirmed intake correction',
      isSystemOverride: true,
    }
  }

  if (lower.includes('chronology-fix') || lower.includes('chronology fix')) {
    return {
      label: 'Chronology',
      tone: 'reconciliation',
      tooltip: 'Intake date adjusted during stock-chain chronology reconciliation',
      isSystemOverride: true,
    }
  }

  if (lower.includes('discrepancy') || lower.includes('stock-chain') || lower.startsWith('auto')) {
    return {
      label: 'Reconciled',
      tone: 'reconciliation',
      tooltip: 'Created or adjusted during automated stock-chain discrepancy reconciliation',
      isSystemOverride: true,
    }
  }

  if (lower.includes('supplemental') || lower.includes('gap')) {
    return {
      label: 'Backfill',
      tone: 'reconciliation',
      tooltip: 'Backfilled intake to align warehouse stock with delivery records',
      isSystemOverride: true,
    }
  }

  const label = raw.length > 28 ? `${raw.slice(0, 26)}…` : raw
  return {
    label,
    tone: 'manual',
    tooltip: raw,
    isSystemOverride: false,
  }
}

/** Warehouse on-hand is capped at 0; flag when delivery records exceed intakes. */
export function getWarehouseStockDiscrepancy(
  received: number,
  delivered: number
): WarehouseStockDiscrepancy | null {
  if (delivered <= received) return null

  if (received === 0) {
    return {
      kind: 'delivery_without_intake',
      message:
        'Units were delivered to supermarkets but no intake is on record. On-hand is shown as 0; stock may have been backfilled from delivery records during reconciliation.',
    }
  }

  return {
    kind: 'over_delivered',
    message: `Delivered (${delivered}) exceeds received (${received}). On-hand is capped at 0 — review intake and delivery records for this product.`,
  }
}

export function intakeRowDiscrepancyTooltip(
  reference: string | null | undefined,
  stockDiscrepancy: WarehouseStockDiscrepancy | null
): string | null {
  const ref = parseIntakeReference(reference)
  const parts: string[] = []
  if (ref?.isSystemOverride) parts.push(ref.tooltip)
  if (stockDiscrepancy) parts.push(stockDiscrepancy.message)
  return parts.length ? parts.join(' ') : null
}

export function intakeRowHasDiscrepancyHint(
  reference: string | null | undefined,
  stockDiscrepancy: WarehouseStockDiscrepancy | null
): boolean {
  const ref = parseIntakeReference(reference)
  return Boolean(ref?.isSystemOverride || stockDiscrepancy)
}
