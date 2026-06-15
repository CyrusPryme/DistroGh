'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { useSession } from '@/hooks/useSession'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ArrowRight, Download, Eye, EyeOff, Plus, Info
} from 'lucide-react'
import {
  parseExcelFile,
  generateSampleExcel,
  rematchImportRows,
  isRowReadyToImport,
  getImportRowLinkKey,
  productsForImportRow,
  type ProductLookup,
} from '@/lib/excel-parser'
import { salesService } from '@/services/sales.service'
import { productService } from '@/services/product.service'
import { supermarketService } from '@/services/supermarket.service'
import { vendorService } from '@/services/vendor.service'
import { createProductAdmin } from '@/app/dashboard/products/actions'
import { ProductModal } from '@/components/products/ProductModal'
import { SupermarketModal } from '@/components/supermarkets/SupermarketModal'
import { importSettingsSchema, type ImportSettingsValues, type ProductFormValues, type SupermarketFormValues } from '@/lib/validations'
import { formatGHS, formatNumber, cn, downloadBlob, getDefaultReportMonth, reportMonthToRange, weekStartToReportMonth, formatReportMonth } from '@/lib/utils'
import { formatSupermarketLabel } from '@/lib/supermarket-display'
import { getSupermarketChainNames, supermarketsInChain } from '@/lib/supermarket-chains'
import {
  saveSalesImportDraft,
  loadSalesImportDraft,
  clearSalesImportDraft,
} from '@/lib/sales-import-session'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import type { ImportPreview, ParsedSaleRow, Supermarket, Vendor } from '@/types'

function toSupermarketLookup(list: Supermarket[]) {
  return list.map((s) => ({
    id: s.id,
    name: s.name,
    branch: s.branch ?? null,
    store_code: s.store_code ?? null,
  }))
}
export default function SalesImportPage() {
  const router = useRouter()
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { role, vendorId, loading: sessionLoading } = useSession({
    requireAuth: true,
    ensureVendorProfile: true,
  })
  const [previewPage, setPreviewPage] = useState(1)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [productPrefill, setProductPrefill] = useState<Partial<ProductFormValues> | null>(null)
  const [productVendorHint, setProductVendorHint] = useState<string | null>(null)
  const [importPriceHint, setImportPriceHint] = useState<string | null>(null)
  const [addingProduct, setAddingProduct] = useState(false)
  const [supermarketModalOpen, setSupermarketModalOpen] = useState(false)
  const [supermarketPrefill, setSupermarketPrefill] = useState<Partial<SupermarketFormValues> | null>(null)
  const [addingSupermarket, setAddingSupermarket] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [resumedSession, setResumedSession] = useState(false)
  const sessionRestoredRef = useRef(false)
  const [manualProductLinks, setManualProductLinks] = useState<Record<string, string>>({})
  const [matchProducts, setMatchProducts] = useState<ProductLookup[]>([])
  const [changeLinkKeys, setChangeLinkKeys] = useState<Set<string>>(new Set())

  const defaultReportMonth = getDefaultReportMonth()

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm<ImportSettingsValues>({
    resolver: zodResolver(importSettingsSchema),
    defaultValues: {
      reporting_supermarket_name: '',
      supermarket_id: '',
      report_month: defaultReportMonth,
    },
  })

  const reportingChain = watch('reporting_supermarket_name')
  const supermarketId = watch('supermarket_id')
  const reportMonth = watch('report_month')

  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([])

  const chainNames = useMemo(() => getSupermarketChainNames(supermarkets), [supermarkets])
  const outletsInChain = useMemo(
    () => (reportingChain ? supermarketsInChain(supermarkets, reportingChain) : []),
    [supermarkets, reportingChain]
  )

  useEffect(() => {
    supermarketService.getAll().then(setSupermarkets)
    vendorService.getAll().then(setVendors)
  }, [])

  useEffect(() => {
    if (!sessionLoading && role === 'vendor') {
      router.replace('/dashboard/vendor')
    }
  }, [sessionLoading, role, router])

  useEffect(() => {
    if (sessionLoading || sessionRestoredRef.current) return
    sessionRestoredRef.current = true

    const draft = loadSalesImportDraft()
    if (!draft) {
      setSessionReady(true)
      return
    }

    const restore = async () => {
      try {
        setFileName(draft.fileName)
        setPreviewPage(draft.previewPage)
        setShowUnmatched(draft.showUnmatched)
        setManualProductLinks(draft.manualProductLinks ?? {})
        const legacy = draft.settings as ImportSettingsValues & { week_start?: string }
        const restoredMonth =
          legacy.report_month ??
          (legacy.week_start ? weekStartToReportMonth(legacy.week_start) : defaultReportMonth)
        reset({
          reporting_supermarket_name: legacy.reporting_supermarket_name ?? '',
          supermarket_id: legacy.supermarket_id ?? '',
          report_month: restoredMonth,
        })

        const [products, vendorList, supermarketList] = await Promise.all([
          productService.getAllForMatching(role === 'vendor' && vendorId ? vendorId : undefined),
          vendorService.getAll(),
          supermarketService.getAll(),
        ])
        setVendors(vendorList)
        setSupermarkets(supermarketList)
        const vendorLookup = vendorList.map((v) => ({ id: v.id, name: v.name }))
        setMatchProducts(products)
        const chainForRematch = legacy.reporting_supermarket_name?.trim() ?? ''
        const chainOutlets = chainForRematch
          ? toSupermarketLookup(supermarketsInChain(supermarketList, chainForRematch))
          : []
        const rematched = rematchImportRows(
          draft.preview.rows,
          products,
          vendorLookup,
          chainForRematch ? chainOutlets : toSupermarketLookup(supermarketList),
          !!draft.preview.uses_branch_matching,
          draft.manualProductLinks ?? {},
          chainForRematch || undefined
        )
        setPreview(rematched)
        setStep('preview')
        setResumedSession(true)
      } catch {
        clearSalesImportDraft()
      } finally {
        setSessionReady(true)
      }
    }

    restore()
  }, [sessionLoading, role, vendorId, reset])

  useEffect(() => {
    if (!sessionReady || step !== 'preview' || !preview) return

    saveSalesImportDraft({
      step: 'preview',
      preview,
      fileName,
      settings: {
        reporting_supermarket_name: reportingChain,
        supermarket_id: supermarketId,
        report_month: reportMonth,
      },
      previewPage,
      showUnmatched,
      manualProductLinks,
      savedAt: Date.now(),
    })
  }, [
    sessionReady,
    step,
    preview,
    fileName,
    reportingChain,
    supermarketId,
    reportMonth,
    previewPage,
    showUnmatched,
    manualProductLinks,
  ])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setFileName(file.name)
    setParsing(true)
    setError(null)

    try {
      const buffer = await file.arrayBuffer()
      const [products, vendorList, supermarketList] = await Promise.all([
        productService.getAllForMatching(role === 'vendor' && vendorId ? vendorId : undefined),
        vendorService.getAll(),
        supermarketService.getAll(),
      ])
      setVendors(vendorList)
      setSupermarkets(supermarketList)
      const vendorLookup = vendorList.map((v) => ({ id: v.id, name: v.name }))
      setMatchProducts(products)
      setManualProductLinks({})
      setChangeLinkKeys(new Set())
      const result = await parseExcelFile(buffer, products, vendorLookup, toSupermarketLookup(supermarketList))
      setPreview(result)
      setPreviewPage(1)
      setStep('preview')
    } catch (e: any) {
      setError(e.message ?? 'Failed to parse Excel file')
    } finally {
      setParsing(false)
    }
  }, [role, vendorId])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: parsing,
  })

  const handleImport = async (data: ImportSettingsValues) => {
    if (!preview) return
    const usesBranch = !!preview.uses_branch_matching
    if (!data.reporting_supermarket_name?.trim()) {
      setError('Select the supermarket that sent this report')
      return
    }
    if (!usesBranch && !data.supermarket_id?.trim()) {
      setError('Select the outlet for this report')
      return
    }

    const importableRows = preview.rows.filter((r) => isRowReadyToImport(r, usesBranch))
    if (importableRows.length !== preview.rows.length) {
      const blocked = preview.rows.length - importableRows.length
      setError(
        `Import blocked: ${blocked} of ${preview.rows.length} row(s) still need product links, branches, or price fixes. All rows must be resolved — nothing is skipped.`
      )
      return
    }

    setImporting(true)
    setError(null)
    try {
      const { week_start, week_end } = reportMonthToRange(data.report_month)
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
      const inserts = importableRows.map(row => ({
        product_id: row.product_id!,
        supermarket_id: usesBranch ? row.import_supermarket_id! : data.supermarket_id!,
        qty_sold: row.qty_sold,
        unit_price: row.unit_price,
        total_sales: row.total_sales,
        commission_amount: row.commission_amount,
        vendor_due: row.vendor_due,
        week_start,
        week_end,
        import_batch_id: batchId,
      }))
      await salesService.bulkInsert(inserts)
      clearSalesImportDraft()
      setImportedCount(importableRows.length)
      setStep('done')
      setResumedSession(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  const handleReset = () => {
    clearSalesImportDraft()
    setStep('upload')
    setPreview(null)
    setFileName('')
    setError(null)
    setImportedCount(0)
    setPreviewPage(1)
    setResumedSession(false)
    setProductModalOpen(false)
    setProductPrefill(null)
    setProductVendorHint(null)
    setImportPriceHint(null)
    setSupermarketModalOpen(false)
    setSupermarketPrefill(null)
    setManualProductLinks({})
    setChangeLinkKeys(new Set())
    setMatchProducts([])
    reset({
      reporting_supermarket_name: '',
      supermarket_id: '',
      report_month: defaultReportMonth,
    })
  }

  const rematchPreview = async (
    links: Record<string, string> = manualProductLinks,
    chainName: string = reportingChain ?? ''
  ) => {
    if (!preview) return
    const [products, supermarketList] = await Promise.all([
      productService.getAllForMatching(),
      supermarketService.getAll(),
    ])
    setMatchProducts(products)
    setSupermarkets(supermarketList)
    const vendorLookup = vendors.map((v) => ({ id: v.id, name: v.name }))
    const chain = chainName.trim()
    const lookup = chain
      ? toSupermarketLookup(supermarketsInChain(supermarketList, chain))
      : toSupermarketLookup(supermarketList)
    setPreview(
      rematchImportRows(
        preview.rows,
        products,
        vendorLookup,
        lookup,
        !!preview.uses_branch_matching,
        links,
        chain || undefined
      )
    )
  }

  useEffect(() => {
    if (!preview || !reportingChain?.trim()) return
    if (!preview.uses_branch_matching) {
      if (outletsInChain.length === 1) {
        setValue('supermarket_id', outletsInChain[0].id)
      }
      return
    }
    void rematchPreview(manualProductLinks, reportingChain)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rematch outlets when reporting chain changes
  }, [reportingChain])

  const handleLinkProduct = async (row: ParsedSaleRow, productId: string) => {
    const linkKey = getImportRowLinkKey(row)
    const next = { ...manualProductLinks }
    if (!productId) {
      delete next[linkKey]
      setChangeLinkKeys((prev) => new Set(prev).add(linkKey))
    } else {
      next[linkKey] = productId
      setChangeLinkKeys((prev) => {
        const updated = new Set(prev)
        updated.delete(linkKey)
        return updated
      })
    }
    setManualProductLinks(next)
    await rematchPreview(next)
    if (productId) {
      const affected = preview?.rows.filter((r) => getImportRowLinkKey(r) === linkKey).length ?? 1
      showToast(
        affected > 1
          ? `Linked ${affected} spreadsheet rows to the selected product`
          : 'Product linked — preview updated'
      )
    }
  }

  const closeProductModal = () => {
    setProductModalOpen(false)
    setProductPrefill(null)
    setProductVendorHint(null)
    setImportPriceHint(null)
  }

  const openAddProduct = (row: ParsedSaleRow) => {
    const sheetUnit = row.sheet_unit_price ?? row.unit_price ?? 0
    const sheetLine = row.sheet_line_total ?? (sheetUnit > 0 ? sheetUnit * row.qty_sold : 0)
    setProductPrefill({
      name: row.product_name,
      barcode: row.product_code ?? '',
      sku: row.product_code ?? '',
      vendor_id: row.vendor_id ?? '',
      vendor_price: sheetUnit > 0 ? sheetUnit : 0,
      distrogh_markup: 0,
    })
    setImportPriceHint(
      sheetUnit > 0
        ? sheetLine > 0 && row.qty_sold > 0
          ? `From spreadsheet: TCostEx ${formatGHS(sheetLine)} ÷ ${row.qty_sold} = ${formatGHS(sheetUnit)} per unit. Shop price (vendor + markup) is pre-filled to match.`
          : `From spreadsheet: ${formatGHS(sheetUnit)} per unit. Shop price (vendor + markup) is pre-filled to match.`
        : null
    )
    setProductVendorHint(
      row.vendor_error ??
        (!row.vendor_id && row.spreadsheet_vendor_name
          ? `Vendor "${row.spreadsheet_vendor_name}" from the spreadsheet was not found. Select a vendor — every product must belong to a vendor.`
          : !row.vendor_id
            ? 'Select a vendor — every product must belong to a vendor.'
            : null)
    )
    setProductModalOpen(true)
  }

  const handleAddProduct = async (data: ProductFormValues) => {
    if (!data.vendor_id?.trim()) {
      throw new Error('Please select a vendor — every product must belong to a vendor.')
    }
    setAddingProduct(true)
    try {
      const result = await createProductAdmin(data)
      if ('error' in result) {
        throw new Error(result.error)
      }
      await rematchPreview()
      closeProductModal()
      showToast(`Product "${data.name}" added — preview updated`)
    } finally {
      setAddingProduct(false)
    }
  }

  const openAddSupermarket = (row: ParsedSaleRow) => {
    setSupermarketPrefill({
      name: reportingChain?.trim() || '',
      location: row.branch?.trim() || '',
      branch: row.branch?.trim() || '',
      store_code: row.store_code?.trim() || '',
    })
    setSupermarketModalOpen(true)
  }

  const handleAddSupermarket = async (data: SupermarketFormValues) => {
    setAddingSupermarket(true)
    setError(null)
    try {
      await supermarketService.create({
        name: data.name.trim(),
        location: data.location.trim(),
        branch: data.branch?.trim() || null,
        store_code: data.store_code?.trim() || null,
      })
      await rematchPreview()
      setSupermarketModalOpen(false)
      setSupermarketPrefill(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add supermarket')
    } finally {
      setAddingSupermarket(false)
    }
  }

  const importableCount = useMemo(() => {
    if (!preview) return 0
    return preview.rows.filter((r) => isRowReadyToImport(r, !!preview.uses_branch_matching)).length
  }, [preview])

  const allRowsReady = preview
    ? importableCount === preview.rows.length && preview.rows.length > 0
    : false

  const unresolvedCount = preview ? preview.rows.length - importableCount : 0

  const vendorNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of vendors) map.set(v.id, v.name)
    return map
  }, [vendors])

  const paginatedPreviewRows = useMemo(() => {
    if (!preview?.rows) return []
    return getPageSlice(preview.rows, previewPage, DEFAULT_PAGE_SIZE)
  }, [preview?.rows, previewPage])

  if (!sessionReady) {
    return (
      <div className="page-container max-w-4xl flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm">Loading import session...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container max-w-4xl space-y-6">
      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-modal text-sm font-medium animate-slide-up',
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Import Sales</h1>
        <p className="text-slate-500 text-sm mt-0.5">Upload monthly supermarket sales reports from Excel</p>
      </div>

      {step === 'preview' && fileName && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
          <FileSpreadsheet className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold">
              {resumedSession ? 'Import session restored' : 'Import in progress'}
            </p>
            <p className="mt-0.5 text-blue-800">
              Your preview for <span className="font-medium">{fileName}</span> is kept in this browser tab
              until you click <span className="font-medium">Import Records</span> or choose Re-upload.
            </p>
          </div>
        </div>
      )}

      {/* Steps indicator */}
      <div className="flex items-center gap-3">
        {['upload', 'preview', 'done'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
              step === s ? 'bg-brand-600 text-white'
                : i < ['upload', 'preview', 'done'].indexOf(step)
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-200 text-slate-500'
            )}>
              {i < ['upload', 'preview', 'done'].indexOf(step) ? '✓' : i + 1}
            </div>
            <span className={cn(
              'text-sm capitalize font-medium',
              step === s ? 'text-slate-900' : 'text-slate-400'
            )}>
              {s === 'done' ? 'Complete' : s}
            </span>
            {i < 2 && <div className="w-8 h-px bg-slate-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ─────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Download sample */}
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl border border-blue-200">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Download sample Excel template</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Palace format: store, BRANCH, Code, description, Qty, TCostEx, creditor, NAME
                </p>
              </div>
            </div>
            <button
              onClick={async () => downloadBlob(await generateSampleExcel(), 'sample_sales_template.xlsx')}
              className="flex items-center gap-2 text-xs font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Template
            </button>
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
              isDragActive
                ? 'border-brand-400 bg-brand-50'
                : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50',
              parsing && 'opacity-50 cursor-not-allowed'
            )}
          >
            <input {...getInputProps()} />
            {parsing ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-brand-500 animate-spin" />
                <p className="text-slate-600 font-medium">Parsing {fileName}...</p>
              </div>
            ) : isDragActive ? (
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-10 h-10 text-brand-500" />
                <p className="text-brand-600 font-semibold">Drop your Excel file here</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center">
                  <FileSpreadsheet className="w-7 h-7 text-slate-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-700">Drag & drop your Excel file</p>
                  <p className="text-sm text-slate-400 mt-1">or click to browse · .xlsx, .xls</p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <XCircle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Preview ─────────────────────────────────────────── */}
      {step === 'preview' && preview && (
        <form onSubmit={handleSubmit(handleImport)} className="space-y-5">
          {/* Summary banner */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="kpi-card py-3">
              <p className="text-lg font-display font-bold text-slate-800">{preview.rowCount}</p>
              <p className="text-xs text-slate-400">Total Rows</p>
            </div>
            <div className="kpi-card py-3">
              <p className="text-lg font-display font-bold text-emerald-600">{importableCount}</p>
              <p className="text-xs text-slate-400">Ready to import</p>
            </div>
            <div className="kpi-card py-3">
              <p className="text-lg font-display font-bold text-amber-600">
                {unresolvedCount}
              </p>
              <p className="text-xs text-slate-400">Needs attention</p>
            </div>
            <div className="kpi-card py-3">
              <p className="text-lg font-display font-bold text-blue-600">
                {formatGHS(preview.totalSales)}
              </p>
              <p className="text-xs text-slate-400">Total Sales</p>
            </div>
          </div>

          {/* Import settings */}
          <div className="data-card">
            <h3 className="font-display font-semibold text-slate-900 mb-4">Import Settings</h3>
            <p className="text-sm text-slate-600 mb-4">
              Select the <strong>supermarket that sent this report</strong> and the{' '}
              <strong>calendar month</strong> it covers. Branch columns in the spreadsheet are matched to
              outlets under that retailer.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Reporting supermarket <span className="text-red-500">*</span>
                </label>
                <select
                  {...register('reporting_supermarket_name')}
                  className="form-input text-sm appearance-none"
                >
                  <option value="">Select supermarket chain...</option>
                  {chainNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {errors.reporting_supermarket_name && (
                  <p className="mt-1 text-xs text-red-500">{errors.reporting_supermarket_name.message}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Report month <span className="text-red-500">*</span>
                </label>
                <input type="month" {...register('report_month')} className="form-input text-sm" />
                {errors.report_month && (
                  <p className="mt-1 text-xs text-red-500">{errors.report_month.message}</p>
                )}
                {reportMonth && (
                  <p className="mt-1 text-xs text-slate-400">
                    Period: {formatReportMonth(reportMonth)} (
                    {reportMonthToRange(reportMonth).week_start} – {reportMonthToRange(reportMonth).week_end})
                  </p>
                )}
              </div>
              {!preview.uses_branch_matching && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                    Outlet <span className="text-red-500">*</span>
                  </label>
                  <select
                    {...register('supermarket_id')}
                    className="form-input text-sm appearance-none"
                    disabled={!reportingChain}
                  >
                    <option value="">
                      {reportingChain ? 'Select outlet...' : 'Select reporting supermarket first'}
                    </option>
                    {outletsInChain.map((s) => (
                      <option key={s.id} value={s.id}>{formatSupermarketLabel(s)}</option>
                    ))}
                  </select>
                  {reportingChain && outletsInChain.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600">No outlets for this chain — add under Supermarkets.</p>
                  )}
                </div>
              )}
            </div>
            {preview.uses_branch_matching && (
              <p className="mt-4 text-sm text-slate-600">
                This file includes a <strong>BRANCH</strong> column — each row is matched to an outlet under{' '}
                <strong>{reportingChain || 'the selected supermarket'}</strong> by branch and store code.
                {!reportingChain && (
                  <span className="text-amber-700 font-medium"> Select the reporting supermarket above to match branches.</span>
                )}
              </p>
            )}
          </div>

          {(preview.price_mismatch_count ?? 0) > 0 && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-xl">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-sky-900">
                    {preview.price_mismatch_count} row(s) — spreadsheet price differs from catalog distro price
                  </p>
                  <p className="text-xs text-sky-800 mt-2">
                    These sales already happened at the spreadsheet price. Import will record{' '}
                    <span className="font-medium">TCostEx ÷ Qty</span> as the unit price; vendor due stays on the catalog vendor price.
                    The product catalog is not changed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {(preview.unmatched_branches?.length ?? 0) > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-sm font-semibold text-amber-800">
                  {(preview.unmatched_branches ?? []).length} branch(es) not in database — affected rows will be skipped
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(preview.unmatched_branches ?? []).map((branch) => (
                  <span key={branch} className="text-xs font-mono text-amber-700 bg-amber-100 px-2 py-1 rounded">
                    {branch}
                  </span>
                ))}
              </div>
              <p className="text-xs text-amber-600 mt-2">
                Add outlets under Supermarkets (with matching branch names) or use &quot;Add branch&quot; on rows below.
              </p>
            </div>
          )}

          {/* Unmatched warning */}
          {preview.unmatched.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-sm font-semibold text-amber-800">
                    {preview.unmatched.length} spreadsheet product(s) not auto-matched — link or add before import
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUnmatched(!showUnmatched)}
                  className="text-xs text-amber-700 flex items-center gap-1"
                >
                  {showUnmatched ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showUnmatched ? 'Hide' : 'Show'}
                </button>
              </div>
              {showUnmatched && (
                <div className="mt-3 space-y-1">
                  {preview.unmatched.map((name, i) => (
                    <p key={i} className="text-xs font-mono text-amber-700 bg-amber-100 px-2 py-1 rounded">
                      {name}
                    </p>
                  ))}
                  <p className="text-xs text-amber-600 mt-2">
                    Use <span className="font-medium">Link to vendor product</span> when the item exists but the spreadsheet name has a typo,
                    or <span className="font-medium">Add product</span> for items not yet in the database.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Preview table */}
          <div className="data-card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-900">Preview ({fileName})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Product</th>
                    <th>Code</th>
                    <th>Branch</th>
                    <th>Vendor</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit Price</th>
                    <th className="text-right">Total Sales</th>
                    <th className="text-right">Markup</th>
                    <th className="text-right">Vendor Due</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPreviewRows.map((row, i) => {
                    const importable = isRowReadyToImport(row, !!preview.uses_branch_matching)
                    const linkKey = getImportRowLinkKey(row)
                    const rowProducts = productsForImportRow(row, matchProducts)
                    const selectedLinkId = manualProductLinks[linkKey] ?? row.manual_product_id ?? ''
                    const showProductPicker =
                      !row.matched ||
                      changeLinkKeys.has(linkKey) ||
                      !!manualProductLinks[linkKey]
                    return (
                    <tr
                      key={`${previewPage}-${i}-${row.product_name}-${row.branch ?? ''}`}
                      className={cn(
                        importable && row.price_mismatch && 'bg-sky-50/50',
                        !importable && 'opacity-60 bg-amber-50/50'
                      )}
                    >
                      <td>
                        {importable ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-amber-500" />
                        )}
                      </td>
                      <td>
                        <div className="font-medium text-slate-800">{row.product_name}</div>
                        {row.matched && row.matched_product_name && row.product_name !== row.matched_product_name && (
                          <div className="text-xs text-emerald-700 mt-0.5">
                            → {row.matched_product_name}
                            {row.product_link_source === 'manual' ? ' (linked)' : ''}
                          </div>
                        )}
                        {row.error && <div className="text-xs text-amber-600 mt-0.5">{row.error}</div>}
                        {row.price_note && (
                          <div className="text-xs text-sky-700 mt-0.5">{row.price_note}</div>
                        )}
                        {row.price_warning && (
                          <div className="text-xs text-amber-700 mt-0.5">{row.price_warning}</div>
                        )}
                        {(row.sheet_unit_price ?? 0) > 0 && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Sheet: {formatGHS(row.sheet_unit_price!)}/unit
                            {row.matched && !row.price_mismatch ? (
                              <span className="text-emerald-600 ml-1">✓ matches catalog distro price</span>
                            ) : row.matched && row.price_mismatch && (row.catalog_shop_price ?? 0) > 0 ? (
                              <span className="text-sky-700 ml-1">
                                · Catalog distro: {formatGHS(row.catalog_shop_price!)}/unit
                              </span>
                            ) : null}
                          </div>
                        )}
                        {showProductPicker && (
                          <div className="mt-1.5 max-w-xs">
                            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 block mb-1">
                              Link to vendor product
                            </label>
                            <select
                              value={selectedLinkId}
                              onChange={(e) => handleLinkProduct(row, e.target.value)}
                              className="form-input text-xs py-1.5 w-full"
                            >
                              <option value="">
                                {row.vendor_id
                                  ? `Select from ${vendorNameById.get(row.vendor_id) ?? 'vendor'}…`
                                  : 'Select product (all vendors)…'}
                              </option>
                              {rowProducts.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                  {p.barcode || p.sku ? ` · ${p.barcode || p.sku}` : ''}
                                  {!row.vendor_id && vendorNameById.get(p.vendor_id)
                                    ? ` (${vendorNameById.get(p.vendor_id)})`
                                    : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {row.matched && !showProductPicker && (
                          <button
                            type="button"
                            onClick={() => setChangeLinkKeys((prev) => new Set(prev).add(linkKey))}
                            className="mt-1.5 block text-xs text-slate-500 hover:text-brand-600"
                          >
                            Wrong product? Choose another
                          </button>
                        )}
                        {!row.matched && (
                          <button
                            type="button"
                            onClick={() => openAddProduct(row)}
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                          >
                            <Plus className="w-3 h-3" />
                            Add product
                          </button>
                        )}
                      </td>
                      <td className="font-mono text-xs text-slate-600">{row.product_code || '—'}</td>
                      <td className="text-xs text-slate-600">
                        {row.branch || row.store_code || '—'}
                        {row.supermarket_error && (
                          <div className="text-amber-600 mt-0.5">{row.supermarket_error}</div>
                        )}
                        {row.matched && !row.supermarket_matched && preview.uses_branch_matching && (
                          <button
                            type="button"
                            onClick={() => openAddSupermarket(row)}
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                          >
                            <Plus className="w-3 h-3" />
                            Add branch
                          </button>
                        )}
                      </td>
                      <td className="text-xs text-slate-600">
                        {row.spreadsheet_vendor_name || '—'}
                        {row.vendor_error && (
                          <div className="text-amber-600 mt-0.5">{row.vendor_error}</div>
                        )}
                      </td>
                      <td className="text-right">{formatNumber(row.qty_sold)}</td>
                      <td className="text-right font-mono text-sm">{formatGHS(row.unit_price)}</td>
                      <td className="text-right font-mono font-semibold">{formatGHS(row.total_sales)}</td>
                      <td className="text-right font-mono text-violet-600">{formatGHS(row.commission_amount)}</td>
                      <td className="text-right font-mono text-emerald-600 font-semibold">{formatGHS(row.vendor_due)}</td>
                    </tr>
                  )})}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={7}>
                      Totals ({allRowsReady ? 'all rows ready' : `${importableCount} of ${preview.rows.length} ready`})
                    </td>
                    <td className="text-right font-mono">{formatGHS(preview.totalSales)}</td>
                    <td className="text-right font-mono text-violet-600">{formatGHS(preview.totalCommission)}</td>
                    <td className="text-right font-mono text-emerald-600">{formatGHS(preview.totalVendorDue)}</td>
                  </tr>
                </tfoot>
              </table>
              <PaginationBar
                page={previewPage}
                pageSize={DEFAULT_PAGE_SIZE}
                totalItems={preview.rows.length}
                onPageChange={setPreviewPage}
              />
            </div>
          </div>

          {unresolvedCount > 0 && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-900">
                <span className="font-semibold">{unresolvedCount} row(s) still unresolved.</span>{' '}
                Import is disabled until every row is linked, priced, and branch-matched. No rows are skipped or duplicated.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <XCircle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              ← Re-upload
            </button>
            <button
              type="submit"
              disabled={importing || !allRowsReady}
              className="flex-1 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {importing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
              ) : (
                <>
                  Import all {preview.rows.length} records
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* ── Step 3: Done ─────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="data-card text-center py-16">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">Import Successful!</h2>
          <p className="text-slate-500 mb-8">
            {importedCount} sale records have been saved to the database.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={handleReset}
              className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Import Another File
            </button>
            <a
              href="/dashboard/sales"
              className="px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors"
            >
              View Sales Records →
            </a>
          </div>
        </div>
      )}

      <ProductModal
        open={productModalOpen}
        onClose={closeProductModal}
        onSubmit={handleAddProduct}
        vendors={vendors.filter((v) => !v.deleted_at)}
        prefillValues={productPrefill}
        vendorHint={productVendorHint}
        importPriceHint={importPriceHint}
        isSubmitting={addingProduct}
      />

      <SupermarketModal
        open={supermarketModalOpen}
        onClose={() => {
          setSupermarketModalOpen(false)
          setSupermarketPrefill(null)
        }}
        onSubmit={handleAddSupermarket}
        prefillValues={supermarketPrefill}
        isSubmitting={addingSupermarket}
      />

    </div>
  )
}
