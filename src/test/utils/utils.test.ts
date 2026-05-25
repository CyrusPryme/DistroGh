import { describe, it, expect } from 'vitest'
import { roundMoney } from '@/lib/utils'

describe('Utils', () => {
  describe('roundMoney', () => {
    it('should round numbers to 2 decimal places', () => {
      expect(roundMoney(10.123)).toBe(10.12)
      expect(roundMoney(10.125)).toBe(10.13)
      expect(roundMoney(10)).toBe(10.00)
    })

    it('should handle negative numbers', () => {
      expect(roundMoney(-10.123)).toBe(-10.12)
      expect(roundMoney(-10.125)).toBe(-10.12) // Math.round uses round half up
    })

    it('should handle zero', () => {
      expect(roundMoney(0)).toBe(0.00)
      expect(roundMoney(0.001)).toBe(0.00)
    })
  })
})
