import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vendorService } from '@/services/vendor.service'

describe('VendorService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('getAll', () => {
    it('should return an array of vendors', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [{ id: '1', name: 'Test', deleted_at: null }] }),
      } as Response)

      const result = await vendorService.getAll()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getById', () => {
    it('should return vendor when found', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: 'test-id', name: 'Test' } }),
      } as Response)

      const result = await vendorService.getById('test-id')
      expect(result).toEqual({ id: 'test-id', name: 'Test' })
    })

    it('should return null when not found', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: null }),
      } as Response)

      const result = await vendorService.getById('missing')
      expect(result).toBeNull()
    })
  })
})
