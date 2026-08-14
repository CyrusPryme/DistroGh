import type { DependencyNode, MigrationEntityType } from '@/lib/migration/types'

/**
 * Canonical dependency edges (parent must exist before child).
 *
 * The real-world operational order this encodes for warehouse/consignment flow:
 *   1. Receive items   (intakes)     — vendor delivers stock to the DistroGH warehouse
 *   2. Deliver items   (deliveries)  — DistroGH redistributes received stock to supermarkets
 *   3. Returned items  (returns)     — a supermarket sends defective/expired stock back
 *      Sales report    (sales)      — a supermarket reports what it sold
 *
 * Both `returns` and `sales` move stock that was only ever *at* a supermarket because a
 * `deliveries` row put it there, and `deliveries` itself only makes sense once `intakes` shows
 * that stock; a delivery, return, or sale can never legitimately predate the warehouse receipt
 * that stock came from. Declaring these edges (rather than leaving deliveries/returns/sales
 * anchored only to products+supermarkets) is what lets buildDependencyGraph() below flag
 * out-of-order uploads — e.g. staging a Deliveries file while zero Receiving records exist
 * anywhere (this migration or production) — instead of silently importing them anyway.
 */
export const ENTITY_DEPENDENCIES: Record<MigrationEntityType, MigrationEntityType[]> = {
  categories: [],
  vendors: [],
  products: ['vendors', 'categories'],
  supermarket_chains: [],
  supermarkets: ['supermarket_chains'],
  intakes: ['vendors', 'products'],
  deliveries: ['products', 'supermarkets', 'intakes'],
  returns: ['products', 'supermarkets', 'deliveries'],
  sales: ['products', 'supermarkets', 'vendors', 'deliveries'],
  deductions: ['vendors'],
  payouts: ['vendors'],
  service_charges: ['vendors'],
  opening_balances: ['vendors'],
  vendor_documents: ['vendors'],
}

/**
 * Production table each entity's "has this ever actually happened before" check reads from.
 * Entities omitted here (service_charges, opening_balances, vendor_documents) are vendor fields,
 * not their own ledger — their only real dependency is 'vendors', already covered generically.
 * Used by runAnalyse() (lib/migration/process.ts) to tell "not uploaded this time, but it already
 * happened historically" apart from "never recorded anywhere" when computing missing_dependencies.
 */
export const ENTITY_PRODUCTION_TABLE: Partial<Record<MigrationEntityType, string>> = {
  categories: 'categories',
  vendors: 'vendors',
  products: 'products',
  supermarket_chains: 'supermarket_chains',
  supermarkets: 'supermarkets',
  intakes: 'intakes',
  deliveries: 'delivery_runs',
  sales: 'sales',
  returns: 'product_returns',
  deductions: 'vendor_deductions',
  payouts: 'payouts',
}

export const ENTITY_LABELS: Record<MigrationEntityType, string> = {
  categories: 'Categories',
  vendors: 'Vendors',
  products: 'Products',
  supermarket_chains: 'Supermarket Chains',
  supermarkets: 'Supermarkets',
  intakes: 'Receiving',
  deliveries: 'Deliveries',
  sales: 'Historical Sales',
  returns: 'Returns',
  deductions: 'Deductions',
  payouts: 'Payouts',
  service_charges: 'Service Charges',
  opening_balances: 'Opening Balances',
  vendor_documents: 'Vendor Documents',
}

/**
 * Full topological order for production commit — also the real-world operational sequence:
 * receive (intakes) before deliver (deliveries) before returned/sold (returns/sales).
 */
export const CANONICAL_IMPORT_ORDER: MigrationEntityType[] = [
  'categories',
  'vendors',
  'products',
  'supermarket_chains',
  'supermarkets',
  'intakes',
  'deliveries',
  'sales',
  'returns',
  'deductions',
  'payouts',
  'service_charges',
  'opening_balances',
  'vendor_documents',
]

/**
 * Build dependency graph from uploaded entity types + file ids.
 * Only entities present in `present` are included; edges to missing deps are kept
 * so the UI can show "requires X".
 *
 * `productionCounts` (optional — pass the actual row count per entity's backing table when
 * available, e.g. from runAnalyse()) lets a dependency that's absent from *this* migration still
 * count as satisfied if it already happened historically. Without it, every dependency not
 * present in `present` is treated as missing — still correct, just less informed.
 */
export function buildDependencyGraph(
  present: Array<{ entity: MigrationEntityType; file_ids: string[] }>,
  productionCounts: Partial<Record<MigrationEntityType, number>> = {}
): { graph: DependencyNode[]; importOrder: MigrationEntityType[] } {
  const byEntity = new Map(present.map((p) => [p.entity, p.file_ids]))
  const entities = present.map((p) => p.entity)
  const satisfiedFromProduction = (entity: MigrationEntityType) => (productionCounts[entity] ?? 0) > 0

  const rankOf = (entity: MigrationEntityType, seen = new Set<MigrationEntityType>()): number => {
    if (seen.has(entity)) return 0
    seen.add(entity)
    const deps = (ENTITY_DEPENDENCIES[entity] ?? []).filter((d) => byEntity.has(d))
    if (!deps.length) return 0
    return 1 + Math.max(...deps.map((d) => rankOf(d, seen)))
  }

  const graph: DependencyNode[] = entities.map((entity) => {
    const dependsOn = ENTITY_DEPENDENCIES[entity] ?? []
    return {
      entity,
      depends_on: dependsOn,
      missing_dependencies: dependsOn.filter((d) => !byEntity.has(d) && !satisfiedFromProduction(d)),
      file_ids: byEntity.get(entity) ?? [],
      rank: rankOf(entity),
    }
  })

  graph.sort((a, b) => a.rank - b.rank || CANONICAL_IMPORT_ORDER.indexOf(a.entity) - CANONICAL_IMPORT_ORDER.indexOf(b.entity))

  const importOrder = CANONICAL_IMPORT_ORDER.filter((e) => byEntity.has(e))

  return { graph, importOrder }
}
