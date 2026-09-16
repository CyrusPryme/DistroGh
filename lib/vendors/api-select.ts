/** Columns safe to return from list endpoints (never expose plaintext initial_password). */
export const VENDOR_LIST_SELECT = `
  id,
  name,
  momo_number,
  momo_network,
  default_commission,
  created_at,
  updated_at,
  deleted_at,
  status,
  login_email,
  fda_certificate_path,
  facility_expiry_date,
  verified_at,
  verified_by,
  verification_feedback,
  auth_cleanup_done_at,
  contact_phone,
  description,
  list_cleared_at
`.replace(/\s+/g, ' ').trim()

export function stripVendorSecrets<T extends Record<string, unknown>>(row: T): Omit<T, 'initial_password'> {
  const { initial_password: _ignored, ...rest } = row
  return rest
}
