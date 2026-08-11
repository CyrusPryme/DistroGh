import { describe, expect, it } from 'vitest'
import { requiresLiveCategoryChangeConfirmation, normalizeForComparison } from '@/lib/products/category-change'

describe('requiresLiveCategoryChangeConfirmation — Scenario 9: normal live editing', () => {
  it('requires confirmation when changing an existing category to a different one', () => {
    expect(
      requiresLiveCategoryChangeConfirmation({ existingCategory: 'Beverages', incomingCategory: 'Snacks' })
    ).toBe(true)
  })

  it('does not require confirmation once the change has been explicitly confirmed', () => {
    expect(
      requiresLiveCategoryChangeConfirmation({
        existingCategory: 'Beverages',
        incomingCategory: 'Snacks',
        confirmed: true,
      })
    ).toBe(false)
  })

  it('does not require confirmation when the category is unchanged (case/whitespace-insensitive)', () => {
    expect(
      requiresLiveCategoryChangeConfirmation({ existingCategory: 'Beverages', incomingCategory: ' beverages ' })
    ).toBe(false)
  })

  it('does not require confirmation when merely populating a previously-empty category', () => {
    expect(requiresLiveCategoryChangeConfirmation({ existingCategory: null, incomingCategory: 'Snacks' })).toBe(
      false
    )
  })

  it('does not require confirmation when the incoming value is empty (nothing to confirm)', () => {
    expect(requiresLiveCategoryChangeConfirmation({ existingCategory: 'Beverages', incomingCategory: null })).toBe(
      false
    )
  })
})

describe('normalizeForComparison', () => {
  it('collapses case and whitespace for comparison purposes only', () => {
    expect(normalizeForComparison('  Beverages ')).toBe('beverages')
    expect(normalizeForComparison('')).toBeNull()
    expect(normalizeForComparison(null)).toBeNull()
  })
})
