import { z } from 'zod'

export const vendorSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  momo_number: z
    .string()
    .min(10, 'Mobile money number must be at least 10 digits')
    .max(15)
    .regex(/^[0-9+\s-]+$/, 'Invalid phone number format'),
  momo_network: z.enum(['MTN', 'Vodafone', 'AirtelTigo'], {
    required_error: 'Please select a mobile money network',
  }),
  // Optional: pricing/markup is set per product, not per vendor
  default_commission: z
    .number({ invalid_type_error: 'Commission must be a number' })
    .min(0, 'Commission cannot be negative')
    .max(100, 'Commission cannot exceed 100%')
    .optional()
    .default(0),
  facility_expiry_date: z.string().optional().nullable().or(z.literal('')),
  fda_certificate_acquired_at: z.string().optional().nullable().or(z.literal('')),
  contact_phone: z.string().max(20).optional().nullable().or(z.literal('')),
  description: z.string().max(500).optional().nullable().or(z.literal('')),
  access_mode: z.enum(['self_service', 'admin_managed']).optional().default('self_service'),
  contact_person_name: z.string().max(100).optional().nullable().or(z.literal('')),
  report_delivery_notes: z.string().max(500).optional().nullable().or(z.literal('')),
})

export const productSchema = z.object({
  name: z.string().min(2, 'Product name must be at least 2 characters').max(200),
  vendor_id: z.string().uuid('Please select a vendor'),
  vendor_price: z
    .number({ invalid_type_error: 'Vendor price must be a number' })
    .min(0, 'Vendor price cannot be negative'),
  distrogh_markup: z
    .number({ invalid_type_error: 'DistroGH markup must be a number' })
    .min(0, 'DistroGH markup cannot be negative'),
  expiry_date: z.string().optional().nullable().or(z.literal('')),
  sku: z.string().max(50).optional().nullable().or(z.literal('')),
  barcode: z.string().max(50).optional().nullable().or(z.literal('')),
  category: z.string().max(100).optional().nullable().or(z.literal('')),
  packaging_size: z.string().max(50).optional().nullable().or(z.literal('')),
  wholesale_price: z.number().min(0).optional().nullable(),
  mall_retail_price: z.number().min(0).optional().nullable(),
  moq: z.preprocess((a) => (a === '' || a == null || (typeof a === 'number' && Number.isNaN(a)) ? undefined : a), z.number().int().min(1).optional()),
})

export const deductionSchema = z.object({
  amount: z.number({ invalid_type_error: 'Amount must be a number' }).min(0.01, 'Amount must be greater than 0'),
  reason: z.string().min(2, 'Reason is required'),
  deduction_date: z.string().min(1, 'Date is required'),
})

export const payoutSchema = z.object({
  vendor_id: z.string().uuid(),
  amount_paid: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .min(0.01, 'Amount must be greater than 0'),
  momo_txn_id: z.string().min(1, 'Transaction ID is required'),
  week_start: z.string().min(1, 'Week start date is required'),
  week_end: z.string().min(1, 'Week end date is required'),
})

export const importSettingsSchema = z.object({
  supermarket_id: z.string().uuid('Please select a supermarket'),
  week_start: z.string().min(1, 'Week start date is required'),
  week_end: z.string().min(1, 'Week end date is required'),
})

export type VendorFormValues = z.infer<typeof vendorSchema>
export type ProductFormValues = z.infer<typeof productSchema>
export type DeductionFormValues = z.infer<typeof deductionSchema>
export type PayoutFormValues = z.infer<typeof payoutSchema>
export type ImportSettingsValues = z.infer<typeof importSettingsSchema>
