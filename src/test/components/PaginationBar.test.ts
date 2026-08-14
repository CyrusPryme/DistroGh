import { describe, it, expect } from 'vitest'
import { getPageSlice, getTotalPages, ALL_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'

describe('getPageSlice', () => {
  const items = Array.from({ length: 42 }, (_, i) => i)

  it('slices the requested page at the given size', () => {
    expect(getPageSlice(items, 1, 15)).toEqual(items.slice(0, 15))
    expect(getPageSlice(items, 2, 15)).toEqual(items.slice(15, 30))
    expect(getPageSlice(items, 3, 15)).toEqual(items.slice(30, 42))
  })

  it('clamps page numbers below 1 to page 1', () => {
    expect(getPageSlice(items, 0, 15)).toEqual(items.slice(0, 15))
    expect(getPageSlice(items, -5, 15)).toEqual(items.slice(0, 15))
  })

  it('returns every item unsliced when pageSize is the ALL sentinel', () => {
    expect(getPageSlice(items, 1, ALL_PAGE_SIZE)).toEqual(items)
    // Even a stale/out-of-range page number must not truncate the result once "All" is selected
    expect(getPageSlice(items, 5, ALL_PAGE_SIZE)).toEqual(items)
  })

  it('defaults page size behaves the same as an explicit 15', () => {
    expect(getPageSlice(items, 2, DEFAULT_PAGE_SIZE)).toEqual(getPageSlice(items, 2, 15))
  })
})

describe('getTotalPages', () => {
  it('computes ceiling division of totalItems by pageSize', () => {
    expect(getTotalPages(42, 15)).toBe(3)
    expect(getTotalPages(45, 15)).toBe(3)
    expect(getTotalPages(46, 15)).toBe(4)
  })

  it('never returns fewer than 1 page, even for an empty dataset', () => {
    expect(getTotalPages(0, 15)).toBe(1)
  })

  it('always reports exactly 1 page when pageSize is the ALL sentinel', () => {
    expect(getTotalPages(0, ALL_PAGE_SIZE)).toBe(1)
    expect(getTotalPages(9999, ALL_PAGE_SIZE)).toBe(1)
  })
})
