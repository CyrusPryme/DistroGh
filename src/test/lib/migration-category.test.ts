import { describe, expect, it } from 'vitest'
import { normalizeCategoryName, matchCategory, resolveCategoryChange } from '@/lib/migration/category'
import { createMockClient } from './mock-pg-client'

describe('normalizeCategoryName', () => {
  it('collapses whitespace and case so duplicates are never created', () => {
    expect(normalizeCategoryName('Drinks')).toBe('drinks')
    expect(normalizeCategoryName('drinks')).toBe('drinks')
    expect(normalizeCategoryName('  Drinks  ')).toBe('drinks')
    expect(normalizeCategoryName('DRINKS')).toBe('drinks')
    expect(normalizeCategoryName('  Soft   Drinks ')).toBe('soft drinks')
  })

  it('handles null/undefined safely', () => {
    expect(normalizeCategoryName(null)).toBe('')
    expect(normalizeCategoryName(undefined)).toBe('')
  })
})

describe('matchCategory — Scenario 12: duplicate category names with different casing', () => {
  it('matches an exact id first', async () => {
    const client = createMockClient([
      { match: /WHERE id = \$1/, respond: () => ({ rows: [{ id: 'cat-1', name: 'Drinks' }] }) },
    ])
    const result = await matchCategory(client, { categoryId: 'cat-1', categoryName: 'Snacks' })
    expect(result).toEqual({ id: 'cat-1', name: 'Drinks' })
  })

  it('matches an exact name when no id supplied', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-2', name: 'Drinks' }] }) },
    ])
    const result = await matchCategory(client, { categoryName: 'Drinks' })
    expect(result).toEqual({ id: 'cat-2', name: 'Drinks' })
  })

  it('falls back to normalized/case-insensitive/whitespace-trimmed match — " drinks ", "DRINKS" never create a duplicate', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => undefined }, // no exact match
      {
        match: /regexp_replace/,
        respond: ({ params }) => {
          expect(params[0]).toBe('drinks') // normalized form passed through
          return { rows: [{ id: 'cat-3', name: 'Drinks' }] }
        },
      },
    ])
    const result = await matchCategory(client, { categoryName: '  DRINKS ' })
    expect(result).toEqual({ id: 'cat-3', name: 'Drinks' })
  })

  it('returns null when nothing matches and no name was supplied', async () => {
    const client = createMockClient()
    const result = await matchCategory(client, {})
    expect(result).toBeNull()
  })
})

describe('resolveCategoryChange', () => {
  it('Scenario 7 — existing product with same category (any casing/whitespace) → unchanged, no write', async () => {
    const client = createMockClient()
    const result = await resolveCategoryChange(client, {
      existingCategory: 'Beverages',
      incomingCategoryRaw: '  beverages ',
    })
    expect(result.outcome).toBe('unchanged')
    expect(result.resolvedCategory).toBe('Beverages')
    expect(result.previousCategory).toBe('Beverages')
    expect(client.calls.length).toBe(0) // never touches the DB when nothing changes
  })

  it('Scenario 8 — existing product with different category during migration → auto-override, previous category preserved in result', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-juices', name: 'Juices' }] }) },
    ])
    const result = await resolveCategoryChange(client, {
      existingCategory: 'Beverages',
      incomingCategoryRaw: 'Juices',
    })
    expect(result.outcome).toBe('overridden')
    expect(result.previousCategory).toBe('Beverages')
    expect(result.resolvedCategory).toBe('Juices')
    expect(result.createdNewCategory).toBe(false)
  })

  it('Scenario 10 — existing category + incoming NULL → preserved, never nulled out', async () => {
    const client = createMockClient()
    const result = await resolveCategoryChange(client, {
      existingCategory: 'Beverages',
      incomingCategoryRaw: null,
    })
    expect(result.outcome).toBe('preserved')
    expect(result.resolvedCategory).toBe('Beverages')
    expect(client.calls.length).toBe(0)
  })

  it('Scenario 10b — incoming is whitespace-only → also treated as missing, preserved', async () => {
    const client = createMockClient()
    const result = await resolveCategoryChange(client, {
      existingCategory: 'Beverages',
      incomingCategoryRaw: '   ',
    })
    expect(result.outcome).toBe('preserved')
    expect(result.resolvedCategory).toBe('Beverages')
  })

  it('Scenario 11 — existing without category + incoming category → populated', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => ({ rows: [{ id: 'cat-snacks', name: 'Snacks' }] }) },
    ])
    const result = await resolveCategoryChange(client, {
      existingCategory: null,
      incomingCategoryRaw: 'Snacks',
    })
    expect(result.outcome).toBe('populated')
    expect(result.previousCategory).toBeNull()
    expect(result.resolvedCategory).toBe('Snacks')
  })

  it('creates a new category when no match exists and creation is allowed (default for historical migration)', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => undefined },
      { match: /regexp_replace/, respond: () => undefined },
      { match: /INSERT INTO public\.categories/, respond: () => ({ rows: [{ name: 'Frozen Foods' }] }) },
    ])
    const result = await resolveCategoryChange(client, {
      existingCategory: null,
      incomingCategoryRaw: 'Frozen Foods',
    })
    expect(result.outcome).toBe('populated')
    expect(result.resolvedCategory).toBe('Frozen Foods')
    expect(result.createdNewCategory).toBe(true)
  })

  it('Scenario E — cannot match and creation is disabled → unmatchable, existing category untouched (never nulled)', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => undefined },
      { match: /regexp_replace/, respond: () => undefined },
    ])
    const result = await resolveCategoryChange(client, {
      existingCategory: 'Beverages',
      incomingCategoryRaw: 'Nonexistent Category',
      allowNewCategoryCreation: false,
    })
    expect(result.outcome).toBe('unmatchable')
    expect(result.resolvedCategory).toBe('Beverages') // never replaced with null
  })

  it('unmatchable with no pre-existing category leaves resolvedCategory null (never invents one)', async () => {
    const client = createMockClient([
      { match: /WHERE name = \$1/, respond: () => undefined },
      { match: /regexp_replace/, respond: () => undefined },
    ])
    const result = await resolveCategoryChange(client, {
      existingCategory: null,
      incomingCategoryRaw: 'Nonexistent Category',
      allowNewCategoryCreation: false,
    })
    expect(result.outcome).toBe('unmatchable')
    expect(result.resolvedCategory).toBeNull()
  })
})
