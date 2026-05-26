import type { Vendor } from '@/types'

export type FdaVendorFields = Pick<
  Vendor,
  'fda_drive_file_id' | 'fda_certificate_path' | 'facility_expiry_date' | 'fda_certificate_acquired_at'
>

/** Whether the vendor has enough FDA metadata for admin activation. */
export function vendorHasFdaCertificate(vendor: FdaVendorFields): boolean {
  const hasDrive = !!vendor.fda_drive_file_id?.trim()
  const hasLegacyPath = !!vendor.fda_certificate_path?.trim()
  if (!vendor.facility_expiry_date) return false
  if (hasDrive) {
    return !!vendor.fda_certificate_acquired_at
  }
  return hasLegacyPath
}

export function parseIsoDateOnly(value: string): Date | null {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const d = new Date(`${trimmed}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function validateFdaDates(acquired: string, expiry: string): string | null {
  const acquiredDate = parseIsoDateOnly(acquired)
  const expiryDate = parseIsoDateOnly(expiry)
  if (!acquiredDate || !expiryDate) {
    return 'Valid date acquired and facility expiry dates are required (YYYY-MM-DD)'
  }
  if (expiryDate <= acquiredDate) {
    return 'Facility expiry date must be after the date acquired'
  }
  return null
}

export function sanitizeVendorFileSlug(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
}

export function buildFdaDriveFileName(params: {
  vendorId: string
  vendorName: string
  acquiredDate: string
  expiryDate: string
  ext: string
}): string {
  const slug = sanitizeVendorFileSlug(params.vendorName) || 'Vendor'
  const shortId = params.vendorId.replace(/-/g, '').slice(0, 8)
  return `${shortId}_${slug}_FDA_Certificate_acquired-${params.acquiredDate}_expires-${params.expiryDate}.${params.ext}`
}
