import { describe, expect, it } from 'vitest'
import {
  normalizeVendorRowData,
  resolveVendorPhones,
  validateVendorPhones,
} from '@/lib/migration/vendor-fields'

describe('vendor-fields', () => {
  it('keeps momo_number and contact_phone separate when both columns exist', () => {
    const row = {
      name: 'Acme',
      momo_number: '0244111222',
      contact_phone: '0302111222',
      momo_network: 'MTN',
    }
    const { momoNumber, contactPhone } = resolveVendorPhones(row)
    expect(momoNumber).toBe('0244111222')
    expect(contactPhone).toBe('0302111222')
  })

  it('maps Mobile Money Number header to momo_number', () => {
    const normalized = normalizeVendorRowData({
      name: 'Acme',
      'Mobile Money Number': '0244333444',
      Phone: '0302333444',
    })
    expect(normalized.momo_number).toBe('0244333444')
    expect(normalized.contact_phone).toBe('0302333444')
  })

  it('maps legacy phone-only sheet to momo_number with warning path', () => {
    const result = validateVendorPhones({ name: 'Acme', phone: '0244555666', momo_network: 'MTN' })
    expect(result.normalized.momo_number).toBe('0244555666')
    expect(result.errors).toHaveLength(0)
  })

  it('errors when momo_number is missing', () => {
    const result = validateVendorPhones({
      name: 'Acme',
      contact_phone: '0302000111',
      momo_network: 'MTN',
    })
    expect(result.errors.some((e) => e.code === 'MISSING_MOMO_NUMBER')).toBe(true)
  })
})
