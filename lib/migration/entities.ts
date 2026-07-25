import type { DependencyNode, MigrationEntityType } from '@/lib/migration/types'

/** Canonical dependency edges (parent must exist before child). */
export const ENTITY_DEPENDENCIES: Record<MigrationEntityType, MigrationEntityType[]> = {
  categories: [],
  vendors: [],
  products: ['vendors', 'categories'],
  supermarket_chains: [],
  supermarkets: ['supermarket_chains'],
  intakes: ['vendors', 'products'],
  deliveries: ['products', 'supermarkets'],
  sales: ['products', 'supermarkets', 'vendors'],
  returns: ['products', 'supermarkets'],
  deductions: ['vendors'],
  payouts: ['vendors'],
  service_charges: ['vendors'],
  opening_balances: ['vendors'],
  vendor_documents: ['vendors'],
}

export const ENTITY_LABELS: Record<MigrationEntityType, string> = {
  categories: 'Categories',
  vendors: 'Vendors',
  products: 'Products',
  supermarket_chains: 'Supermarket Chains',
  supermarkets: 'Supermarkets',
  intakes: 'Warehouse Receipts',
  deliveries: 'Deliveries',
  sales: 'Historical Sales',
  returns: 'Returns',
  deductions: 'Deductions',
  payouts: 'Payouts',
  service_charges: 'Service Charges',
  opening_balances: 'Opening Balances',
  vendor_documents: 'Vendor Documents',
}

/** Full topological order for production commit. */
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
 */
export function buildDependencyGraph(
  present: Array<{ entity: MigrationEntityType; file_ids: string[] }>
): { graph: DependencyNode[]; importOrder: MigrationEntityType[] } {
  const byEntity = new Map(present.map((p) => [p.entity, p.file_ids]))
  const entities = present.map((p) => p.entity)

  const rankOf = (entity: MigrationEntityType, seen = new Set<MigrationEntityType>()): number => {
    if (seen.has(entity)) return 0
    seen.add(entity)
    const deps = (ENTITY_DEPENDENCIES[entity] ?? []).filter((d) => byEntity.has(d))
    if (!deps.length) return 0
    return 1 + Math.max(...deps.map((d) => rankOf(d, seen)))
  }

  const graph: DependencyNode[] = entities.map((entity) => ({
    entity,
    depends_on: ENTITY_DEPENDENCIES[entity] ?? [],
    file_ids: byEntity.get(entity) ?? [],
    rank: rankOf(entity),
  }))

  graph.sort((a, b) => a.rank - b.rank || CANONICAL_IMPORT_ORDER.indexOf(a.entity) - CANONICAL_IMPORT_ORDER.indexOf(b.entity))

  const importOrder = CANONICAL_IMPORT_ORDER.filter((e) => byEntity.has(e))

  return { graph, importOrder }
}
