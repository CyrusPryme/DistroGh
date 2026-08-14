import { describe, expect, it } from 'vitest'
import { buildDependencyGraph, CANONICAL_IMPORT_ORDER, ENTITY_DEPENDENCIES } from '@/lib/migration/entities'
import { detectEntityType } from '@/lib/migration/detect'

describe('migration dependency graph', () => {
  it('orders sales after products and vendors', () => {
    const { importOrder, graph } = buildDependencyGraph([
      { entity: 'sales', file_ids: ['f1'] },
      { entity: 'products', file_ids: ['f2'] },
      { entity: 'vendors', file_ids: ['f3'] },
    ])
    expect(importOrder.indexOf('vendors')).toBeLessThan(importOrder.indexOf('products'))
    expect(importOrder.indexOf('products')).toBeLessThan(importOrder.indexOf('sales'))
    expect(graph.find((g) => g.entity === 'sales')?.depends_on).toContain('products')
  })

  it('canonical order is stable', () => {
    expect(CANONICAL_IMPORT_ORDER[0]).toBe('categories')
    expect(CANONICAL_IMPORT_ORDER).toContain('opening_balances')
  })

  it('encodes the real operational chain: receive -> deliver -> return/sell', () => {
    expect(ENTITY_DEPENDENCIES.deliveries).toContain('intakes')
    expect(ENTITY_DEPENDENCIES.returns).toContain('deliveries')
    expect(ENTITY_DEPENDENCIES.sales).toContain('deliveries')
    // and the canonical order actually places them in that sequence
    expect(CANONICAL_IMPORT_ORDER.indexOf('intakes')).toBeLessThan(CANONICAL_IMPORT_ORDER.indexOf('deliveries'))
    expect(CANONICAL_IMPORT_ORDER.indexOf('deliveries')).toBeLessThan(CANONICAL_IMPORT_ORDER.indexOf('sales'))
    expect(CANONICAL_IMPORT_ORDER.indexOf('deliveries')).toBeLessThan(CANONICAL_IMPORT_ORDER.indexOf('returns'))
  })

  it('flags a dependency as missing when it is neither uploaded nor ever recorded in production', () => {
    const { graph } = buildDependencyGraph([
      { entity: 'deliveries', file_ids: ['f1'] },
      { entity: 'products', file_ids: ['f2'] },
      { entity: 'supermarkets', file_ids: ['f3'] },
    ])
    // no 'intakes' file staged, and no production counts passed at all -> can't be satisfied
    expect(graph.find((g) => g.entity === 'deliveries')?.missing_dependencies).toContain('intakes')
  })

  it('does not flag a dependency as missing when it already happened in production', () => {
    const { graph } = buildDependencyGraph(
      [
        { entity: 'deliveries', file_ids: ['f1'] },
        { entity: 'products', file_ids: ['f2'] },
        { entity: 'supermarkets', file_ids: ['f3'] },
      ],
      { intakes: 42 }
    )
    expect(graph.find((g) => g.entity === 'deliveries')?.missing_dependencies).not.toContain('intakes')
  })

  it('does not flag a dependency as missing when it is staged in the same migration', () => {
    const { graph } = buildDependencyGraph([
      { entity: 'deliveries', file_ids: ['f1'] },
      { entity: 'intakes', file_ids: ['f4'] },
      { entity: 'products', file_ids: ['f2'] },
      { entity: 'supermarkets', file_ids: ['f3'] },
    ])
    expect(graph.find((g) => g.entity === 'deliveries')?.missing_dependencies).not.toContain('intakes')
  })
})

describe('detectEntityType', () => {
  it('detects palace-style sales', () => {
    expect(
      detectEntityType('January Sales.xlsx', ['Description', 'Code', 'Qty', 'TCostEx', 'BRANCH', 'NAME'])
    ).toBe('sales')
  })

  it('detects vendors from filename', () => {
    expect(detectEntityType('Vendors.xlsx', ['name', 'phone'])).toBe('vendors')
  })

  it('detects products from vendor_price', () => {
    expect(detectEntityType('catalog.xlsx', ['name', 'vendor_name', 'vendor_price'])).toBe('products')
  })
})
