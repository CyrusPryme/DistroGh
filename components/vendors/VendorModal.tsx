'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X, Loader2, User, Phone, AlertCircle, FileText, Calendar } from 'lucide-react'
import { vendorSchema, type VendorFormValues } from '@/lib/validations'
import type { Vendor } from '@/types'

interface VendorModalProps {
  open: boolean
  onClose: () => void
  /** (formData, { fdaFile }) – fdaFile only when adding/replacing certificate */
  onSubmit: (data: VendorFormValues, extras?: { fdaFile?: File }) => Promise<void>
  initialData?: Vendor | null
  isSubmitting?: boolean
}

export function VendorModal({
  open,
  onClose,
  onSubmit,
  initialData,
  isSubmitting,
}: VendorModalProps) {
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [checkingName, setCheckingName] = useState(false)
  const [fdaFile, setFdaFile] = useState<File | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
    setError,
    clearErrors,
  } = useForm<VendorFormValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: '',
      momo_number: '',
      momo_network: 'MTN',
      default_commission: 0,
      facility_expiry_date: '',
      fda_certificate_acquired_at: '',
      contact_phone: '',
      description: '',
      access_mode: 'self_service',
      contact_person_name: '',
      report_delivery_notes: '',
    },
  })

  const accessMode = watch('access_mode')

  // Check if vendor name already exists
  const checkVendorNameExists = async (name: string, excludeId?: string): Promise<boolean> => {
    if (!name || name.trim().length < 2) {
      setNameError(null)
      return true
    }

    setCheckingName(true)
    try {
      const res = await fetch('/api/vendors', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? 'Failed to check vendor name')

      const existingVendor = ((json.data ?? []) as { id: string; name: string; deleted_at?: string | null }[])
        .find((v) => !v.deleted_at && v.name.trim().toLowerCase() === name.trim().toLowerCase())
      if (existingVendor && existingVendor.id !== excludeId) {
        setNameError('A vendor with this name already exists')
        setError('name', { message: 'A vendor with this name already exists' })
        return false
      }
      setNameError(null)
      clearErrors('name')
      return true
    } catch (error) {
      console.error('Error checking vendor name:', error)
      setNameError(null)
      return true
    } finally {
      setCheckingName(false)
    }
  }

  // Handle name input change with debounced validation
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const nameInput = document.querySelector('input[name="name"]') as HTMLInputElement
      if (nameInput && nameInput.value) {
        checkVendorNameExists(nameInput.value, initialData?.id)
      }
    }, 500)

    return () => clearTimeout(timeoutId)
  }, [initialData?.id])

  const handleFormSubmit = async (data: VendorFormValues) => {
    setFormError(null)
    if (fdaFile) {
      const acquired = data.fda_certificate_acquired_at?.trim()
      const expiry = data.facility_expiry_date?.trim()
      if (!acquired || !expiry) {
        setFormError('Date acquired and facility expiry are required when uploading an FDA certificate.')
        return
      }
    }
    const nameOk = await checkVendorNameExists(data.name, initialData?.id)
    if (!nameOk) return
    await onSubmit(data, { fdaFile: fdaFile ?? undefined })
  }

  useEffect(() => {
    if (!open) return
    setNameError(null)
    setFormError(null)
  }, [open])

  useEffect(() => {
    if (initialData) {
      reset({
        name: initialData.name,
        momo_number: initialData.momo_number,
        momo_network: initialData.momo_network,
        default_commission: initialData.default_commission,
        facility_expiry_date: (initialData as any).facility_expiry_date ?? '',
        fda_certificate_acquired_at: (initialData as any).fda_certificate_acquired_at ?? '',
        contact_phone: (initialData as any).contact_phone ?? '',
        description: (initialData as any).description ?? '',
        access_mode: initialData.access_mode ?? 'self_service',
        contact_person_name: initialData.contact_person_name ?? '',
        report_delivery_notes: initialData.report_delivery_notes ?? '',
      })
      setFdaFile(null)
    } else {
      reset({
        name: '',
        momo_number: '',
        momo_network: 'MTN',
        default_commission: 0,
        facility_expiry_date: '',
      fda_certificate_acquired_at: '',
        contact_phone: '',
        description: '',
        access_mode: 'self_service',
        contact_person_name: '',
        report_delivery_notes: '',
      })
      setFdaFile(null)
    }
  }, [initialData, reset])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-modal w-full max-w-md max-h-[min(90vh,720px)] flex flex-col animate-slide-up overflow-hidden my-auto">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-display font-semibold text-slate-900">
              {initialData ? 'Edit Vendor' : 'Add New Vendor'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {initialData ? 'Update vendor details' : 'Register a new vendor in the system'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit(handleFormSubmit, (fieldErrors) => {
            const first = Object.values(fieldErrors)[0]
            setFormError(first?.message ?? 'Please fix the highlighted fields')
          })}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <input type="hidden" {...register('default_commission', { valueAsNumber: true })} />
          {formError ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {formError}
            </p>
          ) : null}
          {/* Vendor Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Vendor Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('name')}
                className={`form-input pl-10 pr-10 ${nameError ? 'border-red-300 focus:border-red-500' : ''}`}
                placeholder="e.g., Kofi Foods Ltd"
              />
              {checkingName && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                </div>
              )}
            </div>
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
            {nameError && (
              <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                <AlertCircle className="w-3 h-3" />
                <span>{nameError}</span>
              </div>
            )}
          </div>

          {/* Portal access mode */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Account type</label>
            <div className="grid grid-cols-1 gap-2">
              <label className="cursor-pointer">
                <input type="radio" value="self_service" {...register('access_mode')} className="sr-only peer" />
                <div className="rounded-xl border-2 border-slate-200 p-3 peer-checked:border-emerald-500 peer-checked:bg-emerald-50 transition-all">
                  <p className="text-sm font-semibold text-slate-800">Portal — vendor logs in</p>
                  <p className="text-xs text-slate-500 mt-0.5">For tech-savvy partners with email access</p>
                </div>
              </label>
              <label className="cursor-pointer">
                <input type="radio" value="admin_managed" {...register('access_mode')} className="sr-only peer" />
                <div className="rounded-xl border-2 border-slate-200 p-3 peer-checked:border-amber-500 peer-checked:bg-amber-50 transition-all">
                  <p className="text-sm font-semibold text-slate-800">Admin-managed — reports only</p>
                  <p className="text-xs text-slate-500 mt-0.5">No login; you print statements and analytics for them</p>
                </div>
              </label>
            </div>
          </div>

          {accessMode === 'admin_managed' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Contact person name</label>
                <input
                  {...register('contact_person_name')}
                  className="form-input"
                  placeholder="e.g., Auntie Akosua"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Report delivery notes</label>
                <textarea
                  {...register('report_delivery_notes')}
                  className="form-input min-h-[56px] resize-y"
                  placeholder="e.g., Collect printed report at Makola every Friday"
                  rows={2}
                />
              </div>
            </>
          )}

          {/* MoMo Network */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Mobile Money Network <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['MTN', 'Vodafone', 'AirtelTigo'] as const).map(net => (
                <label key={net} className="cursor-pointer">
                  <input
                    type="radio"
                    value={net}
                    {...register('momo_network')}
                    className="sr-only peer"
                  />
                  <div className={`
                    flex items-center justify-center py-2 rounded-lg border-2 text-sm font-medium transition-all
                    peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-700
                    border-slate-200 text-slate-500 hover:border-slate-300
                    ${net === 'MTN' ? 'peer-checked:border-yellow-400 peer-checked:bg-yellow-50 peer-checked:text-yellow-700' : ''}
                    ${net === 'Vodafone' ? 'peer-checked:border-red-400 peer-checked:bg-red-50 peer-checked:text-red-700' : ''}
                    ${net === 'AirtelTigo' ? 'peer-checked:border-blue-400 peer-checked:bg-blue-50 peer-checked:text-blue-700' : ''}
                  `}>
                    {net}
                  </div>
                </label>
              ))}
            </div>
            {errors.momo_network && <p className="mt-1 text-xs text-red-500">{errors.momo_network.message}</p>}
          </div>

          {/* MoMo Number */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Mobile Money Number <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('momo_number')}
                className="form-input pl-10 font-mono"
                placeholder="0244123456"
                type="tel"
              />
            </div>
            {errors.momo_number && <p className="mt-1 text-xs text-red-500">{errors.momo_number.message}</p>}
          </div>

          {/* Contact phone */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Contact phone
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('contact_phone')}
                className="form-input pl-10 font-mono"
                placeholder="0244123456"
                type="tel"
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">For business enquiries</p>
          </div>

          {/* Business description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Business description
            </label>
            <textarea
              {...register('description')}
              className="form-input min-h-[56px] resize-y"
              placeholder="Brief description of the business"
              rows={2}
            />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
          </div>

          {/* Facility expiry date */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Date acquired (FDA certificate)
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('fda_certificate_acquired_at')}
                type="date"
                className="form-input pl-10"
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Required when uploading a certificate</p>
            {errors.fda_certificate_acquired_at && (
              <p className="mt-1 text-xs text-red-500">{errors.fda_certificate_acquired_at.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Facility expiry date
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('facility_expiry_date')}
                type="date"
                className="form-input pl-10"
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">Optional; can be updated later</p>
            {errors.facility_expiry_date && <p className="mt-1 text-xs text-red-500">{errors.facility_expiry_date.message}</p>}
          </div>

          {/* FDA certificate (add new or replace) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              FDA certificate
            </label>
            <div className="relative">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setFdaFile(e.target.files?.[0] ?? null)}
                className="form-input pl-10 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {initialData ? 'Choose a file to replace existing certificate (stored in Google Drive)' : 'PDF or image; uploaded to Google Drive'}
            </p>
          </div>

          </div>

          {/* Actions */}
          <div className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-3 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !!nameError}
              className="flex-1 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                initialData ? 'Save Changes' : 'Add Vendor'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
