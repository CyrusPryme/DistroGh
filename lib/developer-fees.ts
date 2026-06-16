/**
 * Developer fee calculation engine.
 *
 * Fee resolution priority (most specific wins):
 *   Product > Category > Vendor > Global
 *
 * Fee types:
 *   percentage  — rate applied to total_sales for the line
 *   fixed       — fixed_amount × qty_sold
 *   hybrid      — max/min/sum of percentage and fixed
 */

import { roundMoney } from '@/lib/utils'
import type { Pool } from 'pg'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeeType = 'percentage' | 'fixed' | 'hybrid'
export type FeeScope = 'global' | 'vendor' | 'product' | 'category'
export type HybridMode = 'max' | 'min' | 'sum'

export interface DeveloperFeeConfig {
  id: string
  name: string
  fee_type: FeeType
  percentage_rate: number
  fixed_amount: number
  hybrid_mode: HybridMode | null
  scope: FeeScope
  scope_id: string | null
  effective_from: string | null
  effective_to: string | null
  is_active: boolean
  priority: number
}

export interface FeeCalculationResult {
  fee: number
  config_id: string | null
  config_name: string | null
  fee_type: FeeType | null
}

// ─── Calculation ──────────────────────────────────────────────────────────────

/**
 * Calculate the developer fee for a single sale line.
 */
export function calculateLineFee(
  qty: number,
  totalSales: number,
  config: DeveloperFeeConfig
): number {
  const q = Math.max(0, qty)
  const ts = Math.max(0, totalSales)

  switch (config.fee_type) {
    case 'percentage':
      return roundMoney((config.percentage_rate / 100) * ts)

    case 'fixed':
      return roundMoney(config.fixed_amount * q)

    case 'hybrid': {
      const pct = (config.percentage_rate / 100) * ts
      const fix = config.fixed_amount * q
      switch (config.hybrid_mode) {
        case 'max': return roundMoney(Math.max(pct, fix))
        case 'min': return roundMoney(Math.min(pct, fix))
        case 'sum': return roundMoney(pct + fix)
        default:    return roundMoney(Math.max(pct, fix))
      }
    }

    default:
      return 0
  }
}

// ─── Resolution ───────────────────────────────────────────────────────────────

const SCOPE_PRIORITY: Record<FeeScope, number> = {
  product:  4,
  category: 3,
  vendor:   2,
  global:   1,
}

/**
 * Resolve the single most-specific applicable fee config for a sale.
 * Configs must already be filtered to only active + within effective dates.
 *
 * @param configs   All active configs (pre-filtered)
 * @param productId UUID of the product sold
 * @param vendorId  UUID of the product's vendor
 * @param category  Product category string (nullable)
 */
export function resolveApplicableFeeConfig(
  configs: DeveloperFeeConfig[],
  productId: string,
  vendorId: string,
  category?: string | null
): DeveloperFeeConfig | null {
  if (!configs.length) return null

  // Score each config: higher scope priority wins; ties broken by explicit `priority` field
  let best: DeveloperFeeConfig | null = null
  let bestScore = -1

  for (const cfg of configs) {
    let applicable = false

    switch (cfg.scope) {
      case 'global':
        applicable = true
        break
      case 'vendor':
        applicable = cfg.scope_id === vendorId
        break
      case 'product':
        applicable = cfg.scope_id === productId
        break
      case 'category':
        applicable = !!category && cfg.scope_id === category
        break
    }

    if (!applicable) continue

    const score = SCOPE_PRIORITY[cfg.scope] * 1000 + cfg.priority
    if (score > bestScore) {
      bestScore = score
      best = cfg
    }
  }

  return best
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Load all currently active fee configs from the database.
 * Filters by is_active = true and effective date range.
 */
export async function loadActiveFeeConfigs(
  pool: Pool | { query: Pool['query'] },
  referenceDate?: string  // YYYY-MM-DD; defaults to today
): Promise<DeveloperFeeConfig[]> {
  const date = referenceDate ?? new Date().toISOString().slice(0, 10)
  const { rows } = await pool.query(
    `SELECT id, name, fee_type, percentage_rate, fixed_amount, hybrid_mode,
            scope, scope_id, effective_from, effective_to, is_active, priority
     FROM public.developer_fee_configs
     WHERE is_active = true
       AND (effective_from IS NULL OR effective_from <= $1::date)
       AND (effective_to   IS NULL OR effective_to   >= $1::date)
     ORDER BY scope, priority DESC`,
    [date]
  )
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    fee_type: r.fee_type,
    percentage_rate: Number(r.percentage_rate ?? 0),
    fixed_amount: Number(r.fixed_amount ?? 0),
    hybrid_mode: r.hybrid_mode ?? null,
    scope: r.scope,
    scope_id: r.scope_id ?? null,
    effective_from: r.effective_from ?? null,
    effective_to: r.effective_to ?? null,
    is_active: Boolean(r.is_active),
    priority: Number(r.priority ?? 0),
  }))
}

/**
 * Check whether developer fees are enabled via system_config.
 */
export async function isDeveloperFeeEnabled(
  pool: Pool | { query: Pool['query'] }
): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM public.system_config WHERE key = 'developer.fee.enabled' LIMIT 1`
    )
    return rows[0]?.value === 'true'
  } catch {
    return false
  }
}

/**
 * Calculate the developer fee for a sale row, returning result or zero.
 */
export function computeSaleFee(
  configs: DeveloperFeeConfig[],
  params: {
    qty: number
    totalSales: number
    productId: string
    vendorId: string
    category?: string | null
  }
): FeeCalculationResult {
  const config = resolveApplicableFeeConfig(configs, params.productId, params.vendorId, params.category)
  if (!config) return { fee: 0, config_id: null, config_name: null, fee_type: null }

  const fee = calculateLineFee(params.qty, params.totalSales, config)
  return { fee, config_id: config.id, config_name: config.name, fee_type: config.fee_type }
}
