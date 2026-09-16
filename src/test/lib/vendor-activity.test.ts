import { describe, expect, it } from 'vitest'
import { parseVendorIdList } from '@/lib/vendor-activity'

describe('parseVendorIdList', () => {
  const a = '550e8400-e29b-41d4-a716-446655440000'
  const b = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

  it('parses comma-separated UUIDs and dedupes', () => {
    expect(parseVendorIdList(`${a}, ${b}, ${a}`)).toEqual([a, b])
  })

  it('returns empty for blank input', () => {
    expect(parseVendorIdList(null)).toEqual([])
    expect(parseVendorIdList('  ,  ')).toEqual([])
  })

  it('skips invalid tokens', () => {
    expect(parseVendorIdList(`not-a-uuid, ${a}`)).toEqual([a])
  })
})
