import type { Vendor, VendorStatus } from '@/types'
import { vendorHasFdaCertificate } from '@/lib/fda-certificate'

export type VendorVerificationStage =
  | 'active'
  | 'suspended'
  | 'awaiting_documents'
  | 'ready_to_activate'

export function getVendorStatus(vendor: Pick<Vendor, 'status'>): VendorStatus {
  return vendor.status ?? 'pending_verification'
}

type VendorVerificationFields = Pick<
  Vendor,
  | 'status'
  | 'fda_drive_file_id'
  | 'fda_certificate_path'
  | 'facility_expiry_date'
  | 'fda_certificate_acquired_at'
  | 'deleted_at'
>

/** Admin verification pipeline after application approval. */
export function getVendorVerificationStage(vendor: VendorVerificationFields): VendorVerificationStage {
  if (vendor.deleted_at) return 'active'
  const status = getVendorStatus(vendor)
  if (status === 'active') return 'active'
  if (status === 'suspended') return 'suspended'
  if (vendorHasFdaCertificate(vendor)) return 'ready_to_activate'
  return 'awaiting_documents'
}

export function canAdminActivateVendor(vendor: VendorVerificationFields): boolean {
  return getVendorVerificationStage(vendor) === 'ready_to_activate'
}
