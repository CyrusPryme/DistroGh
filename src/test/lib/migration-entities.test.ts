import { describe, expect, it } from 'vitest'
import { buildDependencyGraph, CANONICAL_IMPORT_ORDER } from '@/lib/migration/entities'
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
