import type { Vendor, VendorAccessMode } from '@/types'

export function isAdminManagedVendor(v: Pick<Vendor, 'access_mode' | 'login_email'>): boolean {
  return v.access_mode === 'admin_managed'
}

export function isSelfServiceVendor(v: Pick<Vendor, 'access_mode' | 'login_email'>): boolean {
  return v.access_mode === 'self_service' || !v.access_mode
}

export function vendorAccessLabel(mode?: VendorAccessMode | null): string {
  return mode === 'admin_managed' ? 'Admin-managed' : 'Portal'
}

export function vendorAccessDescription(mode?: VendorAccessMode | null): string {
  return mode === 'admin_managed'
    ? 'No portal login — admin delivers printable reports'
    : 'Vendor can log in to the partner portal'
}
