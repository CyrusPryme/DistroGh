'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { useSession } from '@/hooks/useSession'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ArrowRight, Download, Eye, EyeOff
} from 'lucide-react'
import { parseExcelFile, generateSampleExcel } from '@/lib/excel-parser'
import { salesService } from '@/services/sales.service'
import { productService } from '@/services/product.service'
import { supermarketService } from '@/services/supermarket.service'
import { importSettingsSchema, type ImportSettingsValues } from '@/lib/validations'
import { formatGHS, formatNumber, cn, downloadBlob, getWeekRange } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'
import type { ImportPreview, ParsedSaleRow } from '@/types'
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

  const weekRange = getWeekRange()

  const { register, handleSubmit, watch, formState: { errors } } = useForm<ImportSettingsValues>({
    resolver: zodResolver(importSettingsSchema),
    defaultValues: {
      supermarket_id: '',
      week_start: weekRange.week_start,
      week_end: weekRange.week_end,
    },
  })

  const supermarketId = watch('supermarket_id')
  const weekStart = watch('week_start')
  const weekEnd = watch('week_end')

  const [supermarkets, setSupermarkets] = useState<any[]>([])

  useEffect(() => {
    supermarketService.getAll().then(setSupermarkets)
  }, [])

  useEffect(() => {
    if (!sessionLoading && role === 'vendor') {
      router.replace('/dashboard/vendor')
    }
  }, [sessionLoading, role, router])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setFileName(file.name)
    setParsing(true)
    setError(null)

    try {
      const buffer = await file.arrayBuffer()
      const products = await productService.getAllForMatching(
        role === 'vendor' && vendorId ? vendorId : undefined
      )
      const result = await parseExcelFile(buffer, products)
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
    const matchedRows = preview.rows.filter(r => r.matched && r.product_id)

    if (matchedRows.length === 0) {
      setError('No matched products to import')
      return
    }

    setImporting(true)
    setError(null)
    try {
      const inserts = matchedRows.map(row => ({
        product_id: row.product_id!,
        supermarket_id: data.supermarket_id,
        qty_sold: row.qty_sold,
        unit_price: row.unit_price,
        commission_amount: row.commission_amount,
        vendor_due: row.vendor_due,
        week_start: data.week_start,
        week_end: data.week_end,
        import_batch_id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
      }))
      await salesService.bulkInsert(inserts)
      setImportedCount(matchedRows.length)
      setStep('done')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  const handleReset = () => {
    setStep('upload')
    setPreview(null)
    setFileName('')
    setError(null)
    setImportedCount(0)
    setPreviewPage(1)
  }

  const paginatedPreviewRows = useMemo(() => {
    if (!preview?.rows) return []
    return getPageSlice(preview.rows, previewPage, DEFAULT_PAGE_SIZE)
  }, [preview?.rows, previewPage])

  return (
    <div className="page-container max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Import Sales</h1>
        <p className="text-slate-500 text-sm mt-0.5">Upload weekly supermarket sales from Excel</p>
      </div>

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
                <p className="text-xs text-blue-600 mt-0.5">Expected columns: Product | Qty | Price</p>
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
              <p className="text-lg font-display font-bold text-emerald-600">
                {preview.rows.filter(r => r.matched).length}
              </p>
              <p className="text-xs text-slate-400">Matched</p>
            </div>
            <div className="kpi-card py-3">
              <p className="text-lg font-display font-bold text-amber-600">
                {preview.unmatched.length}
              </p>
              <p className="text-xs text-slate-400">Unmatched</p>
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
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Supermarket <span className="text-red-500">*</span>
                </label>
                <select {...register('supermarket_id')} className="form-input text-sm appearance-none">
                  <option value="">Select supermarket...</option>
                  {supermarkets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {errors.supermarket_id && <p className="mt-1 text-xs text-red-500">{errors.supermarket_id.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Week Start <span className="text-red-500">*</span>
                </label>
                <input type="date" {...register('week_start')} className="form-input text-sm" />
                {errors.week_start && <p className="mt-1 text-xs text-red-500">{errors.week_start.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">
                  Week End <span className="text-red-500">*</span>
                </label>
                <input type="date" {...register('week_end')} className="form-input text-sm" />
                {errors.week_end && <p className="mt-1 text-xs text-red-500">{errors.week_end.message}</p>}
              </div>
            </div>
          </div>

          {/* Unmatched warning */}
          {preview.unmatched.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-sm font-semibold text-amber-800">
                    {preview.unmatched.length} unmatched product(s) — will be skipped
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
                      "{name}"
                    </p>
                  ))}
                  <p className="text-xs text-amber-600 mt-2">
                    Add these products in Products → Add Product, then re-import.
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
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit Price</th>
                    <th className="text-right">Total Sales</th>
                    <th className="text-right">Markup</th>
                    <th className="text-right">Vendor Due</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPreviewRows.map((row, i) => (
                    <tr key={`${previewPage}-${i}-${row.product_name}`} className={cn(!row.matched && 'opacity-50 bg-amber-50/50')}>
                      <td>
                        {row.matched ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-amber-500" />
                        )}
                      </td>
                      <td>
                        <div className="font-medium text-slate-800">{row.product_name}</div>
                        {row.error && <div className="text-xs text-amber-600 mt-0.5">{row.error}</div>}
                      </td>
                      <td className="text-right">{formatNumber(row.qty_sold)}</td>
                      <td className="text-right font-mono text-sm">{formatGHS(row.unit_price)}</td>
                      <td className="text-right font-mono font-semibold">{formatGHS(row.total_sales)}</td>
                      <td className="text-right font-mono text-violet-600">{formatGHS(row.commission_amount)}</td>
                      <td className="text-right font-mono text-emerald-600 font-semibold">{formatGHS(row.vendor_due)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Totals (matched rows)</td>
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
              disabled={importing || preview.rows.filter(r => r.matched).length === 0}
              className="flex-1 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {importing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
              ) : (
                <>
                  Import {preview.rows.filter(r => r.matched).length} Records
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
    </div>
  )
}
