'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, Loader2, MapPin, Hash } from 'lucide-react'
import { supermarketSchema, type SupermarketFormValues } from '@/lib/validations'
import type { Supermarket } from '@/types'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'

interface SupermarketModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: SupermarketFormValues) => Promise<void>
  initialData?: Supermarket | null
  prefillValues?: Partial<SupermarketFormValues> | null
  isSubmitting?: boolean
}

export function SupermarketModal({
  open,
  onClose,
  onSubmit,
  initialData,
  prefillValues,
  isSubmitting,
}: SupermarketModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SupermarketFormValues>({
    resolver: zodResolver(supermarketSchema),
    defaultValues: {
      name: '',
      location: '',
      branch: '',
      store_code: '',
    },
  })

  useEffect(() => {
    if (!open) return
    if (initialData) {
      reset({
        name: initialData.name,
        location: initialData.location,
        branch: initialData.branch ?? '',
        store_code: initialData.store_code ?? '',
      })
    } else {
      const prefill = prefillValues ?? {}
      reset({
        name: '',
        location: '',
        branch: '',
        store_code: '',
        ...prefill,
      })
    }
  }, [open, initialData, prefillValues, reset])

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={initialData ? 'Edit Supermarket' : 'Add Supermarket'}
      description="Add a retailer outlet. Use branch for chains with multiple locations."
      maxWidthClass="max-w-lg"
      disableBackdropClose={isSubmitting}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <FormModalBody className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Retailer name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input {...register('name')} className="form-input pl-10" placeholder="e.g. Palace" />
            </div>
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Branch <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input {...register('branch')} className="form-input" placeholder="e.g. ADENTA" />
              <p className="mt-1 text-xs text-slate-400">Required for multi-branch retailers</p>
              {errors.branch && <p className="mt-1 text-xs text-red-500">{errors.branch.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Store code <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input {...register('store_code')} className="form-input pl-10 font-mono" placeholder="e.g. 1050" />
              </div>
              {errors.store_code && <p className="mt-1 text-xs text-red-500">{errors.store_code.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Location / area <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input {...register('location')} className="form-input pl-10" placeholder="e.g. Adenta, Accra" />
            </div>
            {errors.location && <p className="mt-1 text-xs text-red-500">{errors.location.message}</p>}
          </div>
        </FormModalBody>

        <FormModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : initialData ? 'Save Changes' : 'Add Supermarket'}
          </button>
        </FormModalFooter>
      </form>
    </FormModal>
  )
}
