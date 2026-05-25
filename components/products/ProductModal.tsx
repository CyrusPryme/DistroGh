'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Package, User, Calendar, Barcode, Layers, Image } from 'lucide-react'
import { productSchema, type ProductFormValues } from '@/lib/validations'
import type { Product, Vendor } from '@/types'
import { formatGHS } from '@/lib/utils'
import { resolveProductPricing } from '@/lib/product-pricing'
import { CurrencyInputPrefix } from '@/components/shared/CurrencyInputPrefix'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'

const ADD_NEW_CATEGORY = '__new__'

interface ProductModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: ProductFormValues, extras?: { imageFiles?: File[] }) => Promise<void>
  initialData?: Product | null
  vendors: Vendor[]
  categories?: string[]
  isSubmitting?: boolean
  defaultVendorId?: string
  /** When true, vendor is fixed (e.g. vendor user); show name only, no dropdown */
  vendorOnly?: boolean
}

export function ProductModal({
  open, onClose, onSubmit, initialData, vendors, categories = [], isSubmitting, defaultVendorId, vendorOnly
}: ProductModalProps) {
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [hasExpiry, setHasExpiry] = useState(false)
  const [categorySelect, setCategorySelect] = useState<string>('') // '' or existing category or ADD_NEW_CATEGORY

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      vendor_id: defaultVendorId ?? '',
      vendor_price: 0,
      distrogh_markup: 0,
      expiry_date: '',
      sku: '',
      barcode: '',
      category: '',
      packaging_size: '',
      wholesale_price: undefined,
      mall_retail_price: undefined,
      moq: 1,
    },
  })

  const vendorPrice = watch('vendor_price') ?? 0
  const distroghMarkup = watch('distrogh_markup') ?? 0
  const basePrice = vendorPrice + distroghMarkup

  useEffect(() => {
    const vendorId = vendorOnly && defaultVendorId ? defaultVendorId : (initialData?.vendor_id ?? defaultVendorId ?? '')
    if (initialData) {
      const p = initialData as Product
      const expiry = p.expiry_date ?? ''
      setHasExpiry(!!expiry)
      const pricing = resolveProductPricing(p)
      reset({
        name: p.name,
        vendor_id: vendorOnly ? (defaultVendorId ?? p.vendor_id) : p.vendor_id,
        vendor_price: pricing.vendorPrice,
        distrogh_markup: pricing.markup,
        expiry_date: expiry,
        sku: p.sku ?? '',
        barcode: p.barcode ?? '',
        category: p.category ?? '',
        packaging_size: p.packaging_size ?? '',
        wholesale_price: p.wholesale_price ?? undefined,
        mall_retail_price: p.mall_retail_price ?? undefined,
        moq: p.moq ?? 1,
      })
      setImageFiles([])
      const cat = p.category?.trim() ?? ''
      setCategorySelect(cat && categories.includes(cat) ? cat : (cat ? ADD_NEW_CATEGORY : ''))
    } else {
      setHasExpiry(false)
      setCategorySelect('')
      reset({
        name: '', vendor_id: vendorId, vendor_price: 0, distrogh_markup: 0, expiry_date: '',
        sku: '', barcode: '', category: '', packaging_size: '',
        wholesale_price: undefined, mall_retail_price: undefined, moq: 1,
      })
      setImageFiles([])
    }
  }, [initialData, reset, defaultVendorId, vendorOnly])

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={initialData ? 'Edit Product' : 'Add New Product'}
      description="Link a product to a vendor with commission settings"
      maxWidthClass="max-w-xl"
      disableBackdropClose={isSubmitting}
    >
      <form
        onSubmit={handleSubmit((data) => {
          const payload = { ...data }
          if (!hasExpiry) payload.expiry_date = ''
          return onSubmit(payload, { imageFiles: imageFiles.length > 0 ? imageFiles : undefined })
        })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <FormModalBody className="space-y-4">
          {/* Product Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Product Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('name')}
                className="form-input pl-10"
                placeholder="e.g., Milo 400g"
              />
            </div>
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
            <p className="mt-1 text-xs text-slate-400">
              Must match Excel column name exactly for import matching
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">SKU</label>
              <input {...register('sku')} className="form-input" placeholder="e.g. ML-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Barcode <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input {...register('barcode')} className="form-input pl-10 font-mono" placeholder="For barcode scanner" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
              <select
                value={categorySelect}
                onChange={(e) => {
                  const v = e.target.value
                  setCategorySelect(v)
                  setValue('category', v === ADD_NEW_CATEGORY ? '' : v)
                }}
                className="form-input appearance-none pr-8"
              >
                <option value="">Select category...</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value={ADD_NEW_CATEGORY}>+ Add new category</option>
              </select>
              {categorySelect === ADD_NEW_CATEGORY && (
                <input
                  {...register('category')}
                  className="form-input mt-2"
                  placeholder="Enter new category name"
                  autoFocus
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Packaging size <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input {...register('packaging_size')} className="form-input pl-10" placeholder="e.g. 400g, 1L" />
              </div>
            </div>
          </div>

          {/* Vendor */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Vendor <span className="text-red-500">*</span>
            </label>
            {vendorOnly && vendors.length > 0 ? (
              <>
                <input type="hidden" {...register('vendor_id')} />
                <div className="flex items-center gap-2 form-input bg-slate-50 text-slate-700 pl-10">
                  <User className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>{vendors[0].name}</span>
                </div>
              </>
            ) : (
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select {...register('vendor_id')} className="form-input pl-10 pr-8 appearance-none">
                  <option value="">Select vendor...</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )}
            {errors.vendor_id && <p className="mt-1 text-xs text-red-500">{errors.vendor_id.message}</p>}
          </div>

          {/* Vendor price (all) + DistroGH markup (admin only — vendors never see it) */}
          <div className={vendorOnly ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Vendor Price (GHS) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <CurrencyInputPrefix />
                <input
                  {...register('vendor_price', { valueAsNumber: true })}
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input pl-11"
                  placeholder="0.00"
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">Negotiated price per unit (vendor receives)</p>
              {errors.vendor_price && <p className="mt-1 text-xs text-red-500">{errors.vendor_price.message}</p>}
            </div>

            {vendorOnly && <input type="hidden" {...register('distrogh_markup', { valueAsNumber: true })} />}
            {!vendorOnly && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  DistroGH Markup (GHS) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <CurrencyInputPrefix />
                  <input
                    {...register('distrogh_markup', { valueAsNumber: true })}
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input pl-11"
                    placeholder="0.00"
                  />
                </div>
                <p className="mt-0.5 text-xs text-slate-400">Fixed markup per unit (DistroGH profit on shop price)</p>
                {errors.distrogh_markup && <p className="mt-1 text-xs text-red-500">{errors.distrogh_markup.message}</p>}
              </div>
            )}
          </div>

          <div className={vendorOnly ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Wholesale price (GHS)</label>
              <div className="relative">
                <CurrencyInputPrefix />
                <input {...register('wholesale_price', { valueAsNumber: true })} type="number" step="0.01" min="0" className="form-input pl-11" placeholder="0.00" />
              </div>
            </div>
            {!vendorOnly && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Mall retail price (GHS)</label>
                <div className="relative">
                  <CurrencyInputPrefix />
                  <input {...register('mall_retail_price', { valueAsNumber: true })} type="number" step="0.01" min="0" className="form-input pl-11" placeholder="0.00" />
                </div>
              </div>
            )}
          </div>

          {/* Product expiry â€“ has expiry vs non-perishable */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Product type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="hasExpiry"
                  checked={!hasExpiry}
                  onChange={() => setHasExpiry(false)}
                  className="rounded-full border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">Non-perishable (no expiry)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="hasExpiry"
                  checked={hasExpiry}
                  onChange={() => setHasExpiry(true)}
                  className="rounded-full border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">Has expiry date</span>
              </label>
            </div>
            {hasExpiry && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Expiry date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    {...register('expiry_date')}
                    type="date"
                    className="form-input pl-10"
                  />
                </div>
                {errors.expiry_date && <p className="mt-1 text-xs text-red-500">{errors.expiry_date.message}</p>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              MOQ (minimum order quantity) <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              {...register('moq', { valueAsNumber: true })}
              type="number"
              min={1}
              step={1}
              className="form-input w-24"
              placeholder="1"
            />
            <p className="mt-1 text-xs text-slate-400">Defaults to 1 if left blank.</p>
            {errors.moq && <p className="mt-1 text-xs text-red-500">{errors.moq.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Product images
            </label>
            <div className="relative">
              <Image className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))}
                className="form-input pl-10 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">{imageFiles.length > 0 ? `${imageFiles.length} file(s) selected` : 'JPG, PNG or WebP. Optional.'}</p>
          </div>

          {/* Preview calculation â€“ vendors only see their price; admins see full breakdown */}
          {vendorOnly ? (
            vendorPrice > 0 && (
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Your price per unit</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Vendor receives</span>
                  <span className="font-semibold text-emerald-600">{formatGHS(vendorPrice)}</span>
                </div>
              </div>
            )
          ) : (vendorPrice > 0 || distroghMarkup > 0) && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">Per Unit Breakdown</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Vendor receives</span>
                  <span className="font-semibold text-emerald-600">{formatGHS(vendorPrice)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">DistroGH markup</span>
                  <span className="font-semibold text-violet-600">{formatGHS(distroghMarkup)}</span>
                </div>
                <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm">
                  <span className="font-semibold text-slate-700">Shop price (vendor + markup)</span>
                  <span className="font-bold text-slate-800">{formatGHS(basePrice)}</span>
                </div>
              </div>
            </div>
          )}

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
              {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : initialData ? 'Save Changes' : 'Add Product'}
            </button>
        </FormModalFooter>
      </form>
    </FormModal>
  )
}
