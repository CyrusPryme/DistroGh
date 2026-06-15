'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Package, User, Calendar, Barcode, Layers, AlertTriangle, AlertCircle } from 'lucide-react'
import { productSchema, type ProductFormValues } from '@/lib/validations'
import type { Product, Vendor } from '@/types'
import { formatGHS } from '@/lib/utils'
import {
  computeShopUnitPrice,
  isWholesalePriceSpecified,
  resolveProductPricing,
  resolveWholesalePrice,
} from '@/lib/product-pricing'
import { mergeCategoryOptions, resolveCategoryOption } from '@/lib/product-categories'
import { settingsService } from '@/services/settings.service'
import { CurrencyInputPrefix } from '@/components/shared/CurrencyInputPrefix'
import { FormModal, FormModalBody, FormModalFooter } from '@/components/shared/FormModal'

const ADD_NEW_CATEGORY = '__new__'
const EMPTY_CATEGORIES: string[] = []

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
  /** Pre-fill fields when adding from sales import (no edit mode) */
  prefillValues?: Partial<ProductFormValues> | null
  /** Shown when spreadsheet vendor could not be matched */
  vendorHint?: string | null
  /** TCostEx ÷ Qty hint when adding from sales import */
  importPriceHint?: string | null
}

export function ProductModal({
  open,
  onClose,
  onSubmit,
  initialData,
  vendors,
  categories = EMPTY_CATEGORIES,
  isSubmitting,
  defaultVendorId,
  vendorOnly,
  prefillValues,
  vendorHint,
  importPriceHint,
}: ProductModalProps) {
  const [hasExpiry, setHasExpiry] = useState(false)
  const [categorySelect, setCategorySelect] = useState<string>('') // '' or existing category or ADD_NEW_CATEGORY
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const initKeyRef = useRef<string | null>(null)
  const parentCategoriesRef = useRef(categories)
  parentCategoriesRef.current = categories

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
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
      supermarket_selling_price: undefined,
      moq: 1,
    },
  })

  const vendorPrice = watch('vendor_price') ?? 0
  const distroghMarkup = watch('distrogh_markup') ?? 0
  const basePrice = computeShopUnitPrice({
    vendor_price: vendorPrice,
    distrogh_markup: distroghMarkup,
  })

  const prefillKey = prefillValues ? JSON.stringify(prefillValues) : ''

  useEffect(() => {
    if (!open) {
      setCategoryOptions([])
      return
    }

    let cancelled = false
    const parentCats = parentCategoriesRef.current
    const seedCategory =
      initialData?.category?.trim() || prefillValues?.category?.trim() || ''

    settingsService
      .getCategoryNames()
      .then((names) => {
        if (cancelled) return
        setCategoryOptions(
          mergeCategoryOptions(parentCats, names, seedCategory || undefined)
        )
      })
      .catch(() => {
        if (cancelled) return
        setCategoryOptions(mergeCategoryOptions(parentCats, seedCategory || undefined))
      })

    return () => {
      cancelled = true
    }
  }, [open, initialData?.id, prefillKey, initialData?.category, prefillValues?.category])

  const syncCategorySelect = (categoryValue: string, options: string[]) => {
    const trimmed = categoryValue.trim()
    if (!trimmed) {
      setCategorySelect('')
      return
    }
    const match = resolveCategoryOption(options, trimmed)
    setCategorySelect(match ?? ADD_NEW_CATEGORY)
  }

  useEffect(() => {
    if (!open) {
      initKeyRef.current = null
      setSubmitError(null)
      return
    }

    const sessionKey = `${initialData?.id ?? 'new'}:${prefillKey}`
    if (initKeyRef.current === sessionKey) return
    initKeyRef.current = sessionKey

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
        wholesale_price:
          isWholesalePriceSpecified(p.wholesale_price) &&
          Number(p.wholesale_price) !== pricing.vendorPrice
            ? Number(p.wholesale_price)
            : undefined,
        supermarket_selling_price: p.supermarket_selling_price ?? undefined,
        moq: p.moq ?? 1,
      })
    } else {
      setHasExpiry(false)
      const prefill = prefillValues ?? {}
      reset({
        name: prefill.name ?? '',
        vendor_price: prefill.vendor_price ?? 0,
        distrogh_markup: prefill.distrogh_markup ?? 0,
        expiry_date: prefill.expiry_date ?? '',
        sku: prefill.sku ?? '',
        barcode: prefill.barcode ?? '',
        category: prefill.category ?? '',
        packaging_size: prefill.packaging_size ?? '',
        wholesale_price: prefill.wholesale_price,
        supermarket_selling_price: prefill.supermarket_selling_price,
        moq: prefill.moq ?? 1,
        vendor_id: prefill.vendor_id || vendorId,
      })
    }
  }, [open, initialData, prefillValues, prefillKey, defaultVendorId, vendorOnly, reset])

  useEffect(() => {
    if (!open || categoryOptions.length === 0) return
    const current =
      getValues('category')?.trim() ||
      initialData?.category?.trim() ||
      prefillValues?.category?.trim() ||
      ''
    syncCategorySelect(current, categoryOptions)
  }, [open, categoryOptions, initialData?.category, prefillValues?.category, getValues])

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
        onSubmit={handleSubmit(
          async (data) => {
            setSubmitError(null)
            const payload = { ...data }
            if (!hasExpiry) payload.expiry_date = ''
            payload.wholesale_price = resolveWholesalePrice(
              payload.vendor_price,
              isWholesalePriceSpecified(payload.wholesale_price) ? payload.wholesale_price : null
            )
            try {
              await onSubmit(payload)
            } catch (e: unknown) {
              setSubmitError(e instanceof Error ? e.message : 'Failed to save product')
            }
          },
          () => {
            setSubmitError('Please fix the highlighted fields above. Vendor, product name, and distro price are required.')
          }
        )}
        className="flex min-h-0 flex-1 flex-col"
      >
        <FormModalBody className="space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{submitError}</p>
            </div>
          )}

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
              Matches spreadsheet description or product code on import
            </p>
          </div>

          {importPriceHint && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
              <p>{importPriceHint}</p>
            </div>
          )}

          {vendorHint && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{vendorHint}</p>
            </div>
          )}

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
                {categoryOptions.map((c) => (
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
                <p className="mt-0.5 text-xs text-slate-400">Fixed markup per unit added to vendor price for supermarkets</p>
                {errors.distrogh_markup && <p className="mt-1 text-xs text-red-500">{errors.distrogh_markup.message}</p>}
              </div>
            )}
          </div>

          <div className={vendorOnly ? '' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Wholesale price (GHS)</label>
              <div className="relative">
                <CurrencyInputPrefix />
                <input
                  {...register('wholesale_price', { valueAsNumber: true })}
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input pl-11"
                  placeholder="Same as vendor price"
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">Leave blank when wholesale is the same as vendor price</p>
            </div>
          </div>

          {!vendorOnly && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Supermarket selling price (GHS)
              </label>
              <div className="relative max-w-xs">
                <CurrencyInputPrefix />
                <input
                  {...register('supermarket_selling_price', { valueAsNumber: true })}
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-input pl-11"
                  placeholder="Leave blank if unknown"
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                Optional shelf price supermarkets charge the public. Enter manually when known — not used for vendor payouts or sales import.
              </p>
            </div>
          )}

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

          {/* Preview calculation — vendors only see their price; admins see full breakdown */}
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
                  <span className="font-semibold text-slate-700">Distro price to supermarket</span>
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
