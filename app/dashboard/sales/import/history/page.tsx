'use client'

import { useEffect, useState, useMemo } from 'react'
import { Trash2, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { getImportHistory, deleteSalesBatch, type ImportHistory } from '@/lib/actions/sales'
import { formatDate, cn } from '@/lib/utils'
import { PaginationBar, getPageSlice, DEFAULT_PAGE_SIZE } from '@/components/shared/PaginationBar'

export default function ImportHistoryPage() {
  const [history, setHistory] = useState<ImportHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [histPage, setHistPage] = useState(1)

  const loadHistory = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getImportHistory()
      if (result.success && result.data) {
        setHistory(result.data)
      } else {
        setError(result.error || 'Failed to load import history')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (batchId: string, rowCount: number) => {
    if (!confirm(`Are you sure? This will permanently remove all ${rowCount} sales from batch ${batchId}.`)) {
      return
    }

    setDeleting(batchId)
    try {
      const result = await deleteSalesBatch(batchId)
      if (result.success) {
        setHistory(prev => prev.filter(item => item.import_batch_id !== batchId))
        setToast({ msg: `Successfully deleted batch ${batchId}`, type: 'success' })
      } else {
        setToast({ msg: result.error || 'Failed to delete batch', type: 'error' })
      }
    } catch (e: any) {
      setToast({ msg: e.message || 'Failed to delete batch', type: 'error' })
    } finally {
      setDeleting(null)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    setHistPage(1)
  }, [history.length])

  const paginatedHistory = useMemo(
    () => getPageSlice(history, histPage, DEFAULT_PAGE_SIZE),
    [history, histPage]
  )

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  return (
    <div className="page-container space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Import History</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your recent sales imports</p>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-modal text-sm font-medium animate-slide-up',
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        )}>
          {toast.msg}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="data-card bg-red-50 border-red-200">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-red-900">Error</h3>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="data-card text-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-4" />
          <p className="text-slate-500">Loading import history...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && history.length === 0 && (
        <div className="data-card text-center py-16">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8 text-slate-400" />
          </div>
          <h2 className="font-display text-xl font-semibold text-slate-900 mb-2">No Import History</h2>
          <p className="text-slate-500 mb-6">You haven't imported any sales data yet.</p>
          <a
            href="/dashboard/sales/import"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors"
          >
            Import Sales
          </a>
        </div>
      )}

      {/* History Table */}
      {!loading && !error && history.length > 0 && (
        <div className="data-card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-medium text-slate-700">Date/Time</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-700">Batch ID</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-700">Total Rows</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.map((item) => (
                  <tr key={item.import_batch_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="text-sm text-slate-900">
                        {formatDate(item.imported_at)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(item.imported_at).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <code className="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded font-mono">
                        {item.import_batch_id}
                      </code>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                        {item.row_count} rows
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDelete(item.import_batch_id, item.row_count)}
                        disabled={deleting === item.import_batch_id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {deleting === item.import_batch_id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={histPage}
              pageSize={DEFAULT_PAGE_SIZE}
              totalItems={history.length}
              onPageChange={setHistPage}
            />
          </div>
        </div>
      )}
    </div>
  )
}
