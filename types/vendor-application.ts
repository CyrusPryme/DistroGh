export interface VendorApplication {
  id: string
  store_name: string
  contact_email: string
  contact_phone?: string | null
  description?: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  updated_at: string
  approved_at?: string
  approved_by?: string
  vendor_id?: string
}
