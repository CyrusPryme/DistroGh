import type { Vendor, VendorStatus } from '@/types'

export type VendorVerificationStage =
  | 'active'
  | 'suspended'
  | 'awaiting_documents'
  | 'ready_to_activate'

export function getVendorStatus(vendor: Pick<Vendor, 'status'>): VendorStatus {
  return vendor.status ?? 'pending_verification'
}

/** Admin verification pipeline after application approval. */
export function getVendorVerificationStage(
  vendor: Pick<Vendor, 'status' | 'fda_certificate_path' | 'facility_expiry_date' | 'deleted_at'>
): VendorVerificationStage {
  if (vendor.deleted_at) return 'active'
  const status = getVendorStatus(vendor)
  if (status === 'active') return 'active'
  if (status === 'suspended') return 'suspended'
  if (vendor.fda_certificate_path && vendor.facility_expiry_date) return 'ready_to_activate'
  return 'awaiting_documents'
}

export function canAdminActivateVendor(
  vendor: Pick<Vendor, 'status' | 'fda_certificate_path' | 'facility_expiry_date' | 'deleted_at'>
): boolean {
  return getVendorVerificationStage(vendor) === 'ready_to_activate'
}
